/**
 * Array columns (`array(text())` → `text[]`), against a real Postgres.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  array,
  connect,
  Database,
  getModelDefinitionOrThrow,
  id,
  int,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text,
  toIR
} from '@/db/index'

class Org extends Model {
  static config = {table: 'arr_org'} satisfies ModelConfig<Org>
  static objects = manager(Org)
  id = id()
  name = text()
  features = array(text()) // text[]
  scores = array(int(), {nullable: true}) // integer[] nullable
  tags = array(text(), {default: []}) // text[] with a JS-array DB default
}
new Pylon({db: {models: [Org]}})

const def = getModelDefinitionOrThrow(Org)
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('array columns', () => {
  it('surfaces as a GraphQL list in the IR', () => {
    const ir = toIR([def])
    const features = ir.entities.Org.fields.find(f => f.name === 'features')
    expect(features?.type).toMatchObject({kind: 'list', of: {kind: 'scalar', name: 'String'}})
    expect(features?.column?.array).toBe(true)
  })

  describe.skipIf(!runDb)('round-trips through Postgres', () => {
    let db: Database
    beforeAll(async () => {
      db = connect({connectionString})
      await db.kysely.schema.dropTable('arr_org').ifExists().cascade().execute()
      await syncSchema([def])
    })
    afterAll(async () => {
      if (db) {
        await db.kysely.schema.dropTable('arr_org').ifExists().cascade().execute()
        await db.destroy()
      }
      setDefaultDatabase(undefined)
    })

    it('creates a text[] column and round-trips array values', async () => {
      const org = await Org.objects.create({name: 'acme', features: ['products', 'invoicing'], scores: [1, 2, 3]})
      expect(org.features).toEqual(['products', 'invoicing'])

      const fetched = await Org.objects.get({id: org.id})
      expect(fetched.features).toEqual(['products', 'invoicing'])
      expect(fetched.scores).toEqual([1, 2, 3])
    })

    it('compiles a JS-array default (`default: []`) to a Postgres array literal', async () => {
      // Regression: `defaultTo([])` is an invalid Kysely immediate — an array
      // column must emit `DEFAULT '{}'`. A create that omits `tags` reads back `[]`.
      const org = await Org.objects.create({name: 'defaulted', features: ['x']})
      expect(org.tags).toEqual([])
      const fetched = await Org.objects.get({id: org.id})
      expect(fetched.tags).toEqual([])
    })

    it('the underlying column type is text[]', async () => {
      const row = await db.kysely
        .selectFrom('information_schema.columns' as never)
        .select(['data_type', 'udt_name'] as never)
        .where('table_name' as never, '=', 'arr_org' as never)
        .where('column_name' as never, '=', 'features' as never)
        .executeTakeFirstOrThrow()
      expect((row as any).data_type).toBe('ARRAY')
      expect((row as any).udt_name).toBe('_text') // pg names text[] as _text
    })
  })
})
