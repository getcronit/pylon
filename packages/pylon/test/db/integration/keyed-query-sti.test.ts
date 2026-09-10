/**
 * Batched counts across SINGLE-TABLE-INHERITANCE siblings.
 *
 * Regression: the batch identity was `kind:tableName?where&paths`. STI puts every
 * subtype in ONE table and applies the discriminator (`type = 'MAIL'`) as an implicit
 * SCOPE rather than a member of `where` — so sibling subtypes produced an IDENTICAL
 * token and coalesced into a single batch. Asking one request for the mail count, the
 * note count and the event count returned the FIRST subtype's numbers for all three.
 *
 * Silent, and invisible in isolation: each count is correct when queried alone, which
 * is exactly how it survived. These tests pin both halves — right alone AND right
 * together — plus the base-vs-subtype case (the base spans all subtypes, so it must
 * keep its own batch).
 */
import pg from 'pg'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  batchKey,
  connect,
  Database,
  enumOf,
  foreignKey,
  id,
  manager,
  Model,
  type ModelConfig,
  runAsSystem,
  syncSchema,
  text
} from '@/db/index'

enum EntryKind {
  MAIL = 'MAIL',
  NOTE = 'NOTE',
  EVENT = 'EVENT'
}

class StiThread extends Model {
  static config = {table: 'sti_thread'} satisfies ModelConfig<StiThread>
  static objects = manager(StiThread)
  id = id()
  subject = text()
}
new Pylon({db: {models: [StiThread]}})

class StiEntry extends Model {
  // Base annotates (wide) so the subclasses' `static config` stays assignable.
  static config: ModelConfig<StiEntry> = {
    table: 'sti_entry',
    inheritance: {strategy: 'single-table', discriminator: 'kind'}
  }
  static objects = manager(StiEntry)
  id = id()
  kind = enumOf(EntryKind)
  threadId = foreignKey(() => StiThread)
  body = text({nullable: true})
}
class StiMail extends StiEntry {
  static config = {discriminatorValue: EntryKind.MAIL}
  static objects = manager(StiMail)
}
class StiNote extends StiEntry {
  static config = {discriminatorValue: EntryKind.NOTE}
  static objects = manager(StiNote)
}
class StiEvent extends StiEntry {
  static config = {discriminatorValue: EntryKind.EVENT}
  static objects = manager(StiEvent)
}
new Pylon({db: {models: [StiEntry, StiMail, StiNote, StiEvent]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

// Query counter (patched before connect so the pool's clients are wrapped).
let queries = 0
const origQuery = (pg as any).Client.prototype.query
;(pg as any).Client.prototype.query = function (...a: any[]) {
  queries++
  return origQuery.apply(this, a)
}

describe.skipIf(!runDb)('keyed-query batching across STI siblings (Postgres)', () => {
  let db: Database
  // thread → [mails, notes, events]. Deliberately all different, per kind AND per
  // thread: equal numbers would let a collision pass unnoticed.
  const shape: Record<string, [number, number, number]> = {
    a: [3, 1, 2],
    b: [1, 0, 1],
    c: [0, 2, 0]
  }
  const threads: Record<string, number> = {}

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['sti_entry', 'sti_thread']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()

    await runAsSystem(async () => {
      for (const [name, [mails, notes, events]] of Object.entries(shape)) {
        const th = await StiThread.objects.create({subject: name})
        threads[name] = th.id
        for (let i = 0; i < mails; i++) await StiMail.objects.create({threadId: th.id})
        for (let i = 0; i < notes; i++) await StiNote.objects.create({threadId: th.id})
        for (let i = 0; i < events; i++) await StiEvent.objects.create({threadId: th.id})
      }
    })
  })

  afterAll(async () => {
    await db?.destroy?.()
  })

  const counts = (threadId: number) => [
    StiMail.objects.filter({threadId: batchKey(threadId)}).count(),
    StiNote.objects.filter({threadId: batchKey(threadId)}).count(),
    StiEvent.objects.filter({threadId: batchKey(threadId)}).count()
  ]

  it('keeps sibling subtypes apart when counted in ONE microtask', async () => {
    await runAsSystem(async () => {
      // The regression: three counts resolving together, over the same table,
      // differing ONLY by discriminator.
      for (const [name, [mails, notes, events]] of Object.entries(shape)) {
        const [m, n, e] = await Promise.all(counts(threads[name]))
        expect({m, n, e}, `thread ${name}`).toEqual({m: mails, n: notes, e: events})
      }
    })
  })

  it('agrees with the same counts taken in isolation', async () => {
    await runAsSystem(async () => {
      for (const [name, [mails, notes, events]] of Object.entries(shape)) {
        // One subtype per microtask — the shape that was accidentally correct.
        const id = threads[name]
        expect(await StiMail.objects.filter({threadId: batchKey(id)}).count()).toBe(mails)
        expect(await StiNote.objects.filter({threadId: batchKey(id)}).count()).toBe(notes)
        expect(await StiEvent.objects.filter({threadId: batchKey(id)}).count()).toBe(events)
      }
    })
  })

  it('still batches: N threads × 3 subtypes stays constant, not 3N queries', async () => {
    await runAsSystem(async () => {
      const ids = Object.values(threads)
      queries = 0
      const all = await Promise.all(ids.flatMap(counts))
      // One grouped count per subtype (3), not one per (thread, subtype) pair (9).
      expect(queries).toBeLessThanOrEqual(5)
      // …and splitting the batch by discriminator didn't cost correctness.
      expect(all).toEqual(ids.flatMap((_, i) => shape[Object.keys(shape)[i]]))
    })
  })

  it('the abstract BASE spans every subtype, so it keeps its own batch', async () => {
    await runAsSystem(async () => {
      for (const [name, [mails, notes, events]] of Object.entries(shape)) {
        const id = threads[name]
        const [all, mailsOnly] = await Promise.all([
          StiEntry.objects.filter({threadId: batchKey(id)}).count(),
          StiMail.objects.filter({threadId: batchKey(id)}).count()
        ])
        expect(all, `thread ${name} total`).toBe(mails + notes + events)
        expect(mailsOnly, `thread ${name} mails`).toBe(mails)
      }
    })
  })
})
