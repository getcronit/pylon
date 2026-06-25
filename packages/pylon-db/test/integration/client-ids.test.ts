/**
 * Client-side id generation for text PKs — Prisma's `@default(cuid())` /
 * `@default(uuid())` ported as function defaults resolved at insert.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  createId,
  Database,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text,
  uuidv4
} from '../../src/index'

class CidDoc extends Model {
  static config = {table: 'cid_doc'} satisfies ModelConfig<CidDoc>
  static objects = manager(CidDoc)
  id = text({primaryKey: true, default: createId})
  title = text()
}
new Pylon({db: {models: [CidDoc]}})

class CidEvt extends Model {
  static config = {table: 'cid_evt'} satisfies ModelConfig<CidEvt>
  static objects = manager(CidEvt)
  id = text({primaryKey: true, default: uuidv4})
  name = text()
}
new Pylon({db: {models: [CidEvt]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('createId / uuidv4 generators (unit)', () => {
  it('createId is letter-prefixed, 24 chars, unique', () => {
    const a = createId()
    const b = createId()
    expect(a).toMatch(/^[a-z][a-z0-9]{23}$/)
    expect(a).toHaveLength(24)
    expect(a).not.toBe(b)
  })
  it('uuidv4 is a valid v4 uuid', () => {
    expect(uuidv4()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })
})

describe.skipIf(!runDb)('client-side id defaults (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('cid_doc').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('cid_evt').ifExists().cascade().execute()
    await syncSchema()
  })
  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('cid_doc').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('cid_evt').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('generates a cuid-style id on create when none is provided', async () => {
    const doc = await CidDoc.objects.create({title: 'hello'})
    expect(doc.id).toMatch(/^[a-z][a-z0-9]{23}$/)
    const reloaded = await CidDoc.objects.get({id: doc.id})
    expect(reloaded.title).toBe('hello')
  })

  it('respects an explicitly provided id (generator only fills gaps)', async () => {
    const doc = await CidDoc.objects.create({id: 'explicit-id-123', title: 'x'})
    expect(doc.id).toBe('explicit-id-123')
  })

  it('generates a uuid for a uuidv4 default', async () => {
    const evt = await CidEvt.objects.create({name: 'e'})
    expect(evt.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('does not leak the generator into the migration default (text column)', async () => {
    const cols = await db.kysely.introspection.getTables()
    const doc = cols.find(t => t.name === 'cid_doc')!
    const idCol = doc.columns.find(c => c.name === 'id')!
    // text PK, no server-side default expression from the function generator
    expect(idCol.dataType).toBe('text')
    expect(idCol.hasDefaultValue).toBe(false)
  })
})
