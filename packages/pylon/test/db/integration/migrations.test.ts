import {makeMigration} from '@getcronit/pylon/ir'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  Model,
  connect,
  Database,
  foreignKey,
  id,
  planMigration,
  applyMigration,
  setDefaultDatabase,
  snapshot,
  text
} from '@/db/index'
import type {Relation} from '@/db/relations'

// Unique table names (`mig_*`) so this suite never collides with the other
// integration tests sharing the same Postgres instance under parallel runs.
class MigWriter extends Model {
  static config = {table: 'mig_writer'} satisfies ModelConfig<MigWriter>
  id = id()
  name = text({unique: true})
}
new Pylon({db: {models: [MigWriter]}})

class MigBook extends Model {
  static config = {table: 'mig_book'} satisfies ModelConfig<MigBook>
  id = id()
  title = text()
  writerId = foreignKey(() => MigWriter)
  declare writer: Relation<MigWriter>
}
new Pylon({db: {models: [MigBook]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

async function tableExists(db: Database, name: string): Promise<boolean> {
  const r = await db.kysely
    .selectFrom('information_schema.tables' as never)
    .select('table_name' as never)
    .where('table_name' as never, '=', name as never)
    .where('table_schema' as never, '=', 'public' as never)
    .executeTakeFirst()
  return !!r
}

async function columnExists(db: Database, table: string, column: string): Promise<boolean> {
  const r = await db.kysely
    .selectFrom('information_schema.columns' as never)
    .select('column_name' as never)
    .where('table_name' as never, '=', table as never)
    .where('column_name' as never, '=', column as never)
    .executeTakeFirst()
  return !!r
}

async function dropAll(db: Database) {
  await db.kysely.schema.dropTable('mig_book').ifExists().cascade().execute()
  await db.kysely.schema.dropTable('mig_writer').ifExists().cascade().execute()
}

describe.skipIf(!runDb)('migrations applied to Postgres (IR → diff → SQL → DB)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await dropAll(db)
  })

  afterAll(async () => {
    if (db) {
      await dropAll(db)
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('initial migration creates the tables and FK', async () => {
    const migration = planMigration(null, snapshot())
    expect(migration.up.length).toBeGreaterThan(0)
    await applyMigration(migration)

    expect(await tableExists(db, 'mig_writer')).toBe(true)
    expect(await tableExists(db, 'mig_book')).toBe(true)
    expect(await columnExists(db, 'mig_book', 'writer_id')).toBe(true)
  })

  it('an incremental ADD COLUMN migration applies on top', async () => {
    const current = snapshot()
    const baseline = JSON.parse(JSON.stringify(current)) as typeof current
    const subtitle = {
      name: 'subtitle',
      type: {kind: 'scalar' as const, name: 'String', nullable: true},
      exposed: true,
      column: {
        name: 'subtitle',
        sqlType: 'text' as const,
        primaryKey: false,
        autoIncrement: false,
        unique: false,
        nullable: true
      }
    }
    current.entities.MigBook.fields.push(subtitle as never)

    const migration = makeMigration(baseline.entities, current.entities)
    expect(migration.up).toEqual(['ALTER TABLE "mig_book" ADD COLUMN "subtitle" text'])
    await applyMigration(migration)

    expect(await columnExists(db, 'mig_book', 'subtitle')).toBe(true)
  })
})
