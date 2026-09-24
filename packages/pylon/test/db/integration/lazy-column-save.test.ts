/**
 * Lazy COLUMN + $save regression.
 *
 * A lazy column (`text({lazy: true})`) is excluded from the default select, so a fetched
 * instance carries it UNLOADED — its accessor reads back as a `() => Promise<value>`
 * loader until first read. Saving a change to any OTHER field on such an instance must
 * NOT try to persist (or validate) that loader function.
 *
 * Before the fix, `validateInstance`/`rowFromInstance` saw the loader and rejected it
 * ("<col> must be a string"), so e.g. setting `summary` on a TicketEmail whose lazy
 * `content` wasn't selected threw a ValidationError on every summary job.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {Model, connect, Database, id, manager, runAsSystem, syncSchema, text} from '@/db/index'

class LazyColDoc extends Model {
  static config = {table: 'lz_col_doc'}
  static objects = manager(LazyColDoc)
  id = id()
  title = text()
  body = text({lazy: true})
}
new Pylon({db: {models: [LazyColDoc]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

/** Read a possibly-lazy value: the loader function, or the plain value. */
const read = async (v: unknown) => (typeof v === 'function' ? await (v as () => Promise<unknown>)() : v)

describe.skipIf(!runDb)('lazy column + $save (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('lz_col_doc').ifExists().cascade().execute()
    await syncSchema()
  })
  afterAll(async () => {
    await db?.destroy?.()
  })

  it('saving a sibling field with the lazy column UNLOADED succeeds and leaves it intact', async () => {
    await runAsSystem(async () => {
      const created = await LazyColDoc.objects.create({title: 'a', body: 'BIG-ORIGINAL'})
      // Re-fetch: `body` is lazy → not selected → unloaded (a loader function).
      const fresh = await LazyColDoc.objects.get({id: created.id})
      expect(typeof (fresh as any).body).toBe('function') // sanity: it is the loader

      fresh.title = 'a-updated'
      await fresh.$save() // pre-fix: threw ValidationError "body must be a string"

      const reread = await LazyColDoc.objects.get({id: created.id})
      expect(reread.title).toBe('a-updated')
      // The loader was NOT written back over the column — its value is intact.
      expect(await read((reread as any).body)).toBe('BIG-ORIGINAL')
    })
  })

  it('an explicitly-assigned lazy column still persists', async () => {
    await runAsSystem(async () => {
      const created = await LazyColDoc.objects.create({title: 'b', body: 'v1'})
      const fresh = await LazyColDoc.objects.get({id: created.id})
      ;(fresh as any).body = 'v2' // a real value, not the loader
      await fresh.$save()

      const reread = await LazyColDoc.objects.get({id: created.id})
      expect(await read((reread as any).body)).toBe('v2')
    })
  })
})
