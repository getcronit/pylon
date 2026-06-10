import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {sql} from 'kysely'
import {
  Model,
  connect,
  Database,
  getModelDefinitionOrThrow,
  id,
  introspect,
  model,
  schemaDrift,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'

@model({table: 'drift_widget'})
class DriftWidget extends Model {
  id = id()
  name = text()
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('introspect + drift (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('drift_widget').ifExists().cascade().execute()
    await syncSchema([getModelDefinitionOrThrow(DriftWidget)])
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('drift_widget').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('introspect reports the live table columns', async () => {
    const cols = await introspect(db)
    expect([...(cols.get('drift_widget') ?? [])].sort()).toEqual(['id', 'name'])
  })

  it('schemaDrift is clean for a table matching its model', async () => {
    const d = await schemaDrift(db)
    expect(d.missingTables).not.toContain('drift_widget')
    expect(d.columns.find(c => c.table === 'drift_widget')).toBeUndefined()
  })

  it('detects a column the DB is missing vs the model', async () => {
    await sql`ALTER TABLE "drift_widget" DROP COLUMN "name"`.execute(db.kysely)
    const d = await schemaDrift(db)
    expect(d.columns).toContainEqual({table: 'drift_widget', missing: ['name'], extra: []})
  })
})
