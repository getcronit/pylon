/**
 * Lazy relation connections — the fix for the paginated-relation N+1.
 *
 * A GraphQL relation connection read per row (`{ threads { nodes { notes { totalCount } } } }`)
 * used to cost TWO un-batched queries per parent: the keyset page query AND the count,
 * both eager, whatever the client actually selected. Selecting only `totalCount` still
 * fetched a page of rows and threw them away.
 *
 * `asPaginated` — the GraphQL boundary — now hands back a connection whose halves
 * resolve only if read, so a `totalCount`-only selection collapses to ONE batched
 * grouped count for every parent. The direct `paginate()` API is untouched and stays
 * eager, so `(await qs.paginate()).nodes` is still a real array.
 */
import pg from 'pg'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  manager,
  runAsSystem,
  syncSchema,
  text,
  timestamp,
  type Relation
} from '@/db/index'

class LazyThread extends Model {
  static config = {table: 'lz_thread'}
  static objects = manager(LazyThread)
  id = id()
  title = text()
  notes = hasMany(() => LazyNote, {foreignKey: 'threadId', orderBy: '-createdAt', paginate: true})
}
class LazyNote extends Model {
  static config = {table: 'lz_note'}
  static objects = manager(LazyNote)
  id = id()
  body = text()
  threadId = foreignKey(() => LazyThread)
  createdAt = timestamp()
  declare thread: Relation<LazyThread>
}
new Pylon({db: {models: [LazyThread, LazyNote]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

let queries = 0
const origQuery = (pg as any).Client.prototype.query
;(pg as any).Client.prototype.query = function (...a: any[]) {
  queries++
  return origQuery.apply(this, a)
}

// How GraphQL reaches a paginated relation field: the accessor is CALLED with the
// connection args (first, after, last, before, skip, query).
const conn = (t: LazyThread, query?: string) =>
  (t.notes as any)(undefined, undefined, undefined, undefined, undefined, query)

describe.skipIf(!runDb)('lazy relation connections (Postgres)', () => {
  let db: Database
  const N = 8

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['lz_note', 'lz_thread']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
    await runAsSystem(async () => {
      for (let i = 0; i < N; i++) {
        const th = await LazyThread.objects.create({title: `t${i}`})
        // i notes each — so a wrong batch/collapse shows up as equal counts.
        for (let n = 0; n < i; n++) {
          await LazyNote.objects.create({threadId: th.id, body: `n${n}`, createdAt: new Date(1700000000000 + n)})
        }
      }
    })
  })

  afterAll(async () => {
    await db?.destroy?.()
  })

  it('totalCount-only across N parents is ONE batched count, not 2N queries', async () => {
    await runAsSystem(async () => {
      const threads = await LazyThread.objects.orderBy('title').all()
      queries = 0
      const counts = await Promise.all(threads.map(t => conn(t).totalCount))
      // Was 2N (a page query + a count per parent). Now: one grouped count.
      expect(queries).toBeLessThanOrEqual(2)
      expect(counts).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    })
  })

  it('reading nodes still fetches the page (and stays correct)', async () => {
    await runAsSystem(async () => {
      const t = await LazyThread.objects.get({title: 't3'})
      const c = conn(t)
      const nodes = await c.nodes
      expect(nodes.map((n: LazyNote) => n.body)).toEqual(['n2', 'n1', 'n0']) // declared -createdAt
      expect(await c.totalCount).toBe(3)
      // The page is fetched ONCE and shared across nodes/edges/pageInfo.
      queries = 0
      await Promise.all([c.nodes, c.edges, c.pageInfo, c.startIndex])
      expect(queries).toBe(0)
    })
  })

  it('the `query` arg still filters, and still only counts when only counting', async () => {
    await runAsSystem(async () => {
      const threads = await LazyThread.objects.orderBy('title').all()
      queries = 0
      const counts = await Promise.all(threads.map(t => conn(t, 'body:n0').totalCount))
      expect(queries).toBeLessThanOrEqual(2)
      // Every thread with at least one note has exactly one `n0`.
      expect(counts).toEqual([0, 1, 1, 1, 1, 1, 1, 1])
    })
  })

  it('the direct paginate() API stays EAGER — nodes are arrays, not promises', async () => {
    await runAsSystem(async () => {
      const t = await LazyThread.objects.get({title: 't5'})
      const page = await (t.notes as any).paginate({first: 2})
      expect(Array.isArray(page.nodes)).toBe(true)
      expect(page.nodes).toHaveLength(2)
      expect(page.totalCount).toBe(5)
      expect(page.startIndex).toBe(0)
      expect(page.pageInfo.hasNextPage).toBe(true)
    })
  })
})
