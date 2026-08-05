import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  connect,
  Database,
  id,
  manager,
  setDefaultDatabase,
  json,
  syncSchema,
  text
} from '../../src/index'

// Regression: a `struct` (jsonb) column whose value is a TOP-LEVEL array.
// node-pg serializes JS objects as jsonb (via JSON.stringify) but arrays as
// Postgres ARRAY literals (`{…}`) — invalid for a jsonb column. Before the fix
// (`rowFromInstance` now stringifies jsonb values itself), `[{…}]` threw
// "invalid input syntax for type json" and `[]` was silently stored as `{}`.
class Bag extends Model {
  static objects = manager(Bag)
  id = id()
  label = text()
  items = json<{k: string}[]>() // top-level array
  meta = json<{a: number} | null>({nullable: true}) // object (must keep working)
}
new Pylon({db: {models: [Bag]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('Struct jsonb — top-level array (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('bag').ifExists().cascade().execute()
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('bag').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('round-trips a non-empty top-level array', async () => {
    const row = await Bag.objects.create({
      label: 'a',
      items: [{k: 'x'}, {k: 'y'}],
      meta: {a: 1}
    })
    const read = await Bag.objects.get({id: row.id})
    expect(read.items).toEqual([{k: 'x'}, {k: 'y'}])
    expect(read.meta).toEqual({a: 1})
  })

  it('round-trips an empty array as [] (not silently {})', async () => {
    const row = await Bag.objects.create({label: 'b', items: [], meta: null})
    const read = await Bag.objects.get({id: row.id})
    expect(read.items).toEqual([])
    expect(read.meta).toBeNull()
  })
})
