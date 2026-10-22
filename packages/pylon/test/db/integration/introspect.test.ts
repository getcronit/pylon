import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {sql} from 'kysely'
import {
  type ModelConfig,
  Model,
  connect,
  Database,
  getModelDefinitionOrThrow,
  id,
  introspect,
  schemaDrift,
  setDefaultDatabase,
  syncSchema,
  text
} from '@/db/index'

class DriftWidget extends Model {
  static config = {table: 'drift_widget'} satisfies ModelConfig<DriftWidget>
  id = id()
  name = text()
}
new Pylon({db: {models: [DriftWidget]}})

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

  it('never reports a framework bookkeeping table as extra drift', async () => {
    // The snowflake node-id lease (created by ID({snowflake}) usage), the migration
    // ledger, and the queues outbox are framework-owned — not models — so they must
    // not surface as "extra table" drift.
    await db.kysely.schema
      .createTable('_pylon_nodes')
      .ifNotExists()
      .addColumn('node_id', 'integer')
      .execute()
    const cols = await introspect(db)
    expect(cols.has('_pylon_nodes')).toBe(false)
    const d = await schemaDrift(db)
    expect(d.extraTables).not.toContain('_pylon_nodes')
    expect(d.extraTables).not.toContain('_pylon_migrations')
  })

  it('detects a column the DB is missing vs the model', async () => {
    await sql`ALTER TABLE "drift_widget" DROP COLUMN "name"`.execute(db.kysely)
    const d = await schemaDrift(db)
    expect(d.columns).toContainEqual({table: 'drift_widget', missing: ['name'], extra: []})
  })
})
