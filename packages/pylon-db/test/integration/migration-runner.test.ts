import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {pathToFileURL} from 'node:url'
import {
  Model,
  MigrationRunner,
  connect,
  Database,
  id,
  model,
  setDefaultDatabase,
  snapshot,
  text,
  type MigrationLoader,
  type Snapshot
} from '../../src/index'

// Migration files are TS; vitest transpiles them on import, so the loader is a
// plain dynamic import of the file's default export.
const load: MigrationLoader = async filePath =>
  (await import(pathToFileURL(filePath).href)).default

@model({table: 'runner_widget'})
class RunnerWidget extends Model {
  id = id()
  label = text({unique: true})
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('MigrationRunner.apply — tracked + idempotent (Postgres)', () => {
  let db: Database
  let dir: string

  beforeAll(async () => {
    db = connect({connectionString})
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-mig-it-'))
    await db.kysely.schema.dropTable('runner_widget').ifExists().cascade().execute()
    // start from a clean ledger so the run is deterministic
    await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('runner_widget').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
      await db.destroy()
    }
    await fs.rm(dir, {recursive: true, force: true})
    setDefaultDatabase(undefined)
  })

  it('generates, applies, tracks, and is idempotent on re-apply', async () => {
    let clock = 0
    const runner = new MigrationRunner({
      dir,
      current: () => snapshot() as Snapshot,
      now: () => `t${++clock}`
    })

    const generated = await runner.generate('init')
    expect(generated?.name).toBe('t1_init')

    const appliedFirst = await runner.apply(load, db)
    expect(appliedFirst).toEqual(['t1_init'])

    // table exists
    const exists = await db.kysely
      .selectFrom('information_schema.tables' as never)
      .select('table_name' as never)
      .where('table_name' as never, '=', 'runner_widget' as never)
      .executeTakeFirst()
    expect(!!exists).toBe(true)

    // re-apply is a no-op (idempotent via the ledger)
    const appliedSecond = await runner.apply(load, db)
    expect(appliedSecond).toEqual([])

    const status = await runner.status(db)
    expect(status.unapplied).toEqual([])
  })

  it('rolls back the schema migration: drops the table and clears the ledger', async () => {
    // Self-contained: own dir + clean DB state so it doesn't depend on the
    // apply test's leftover table/ledger rows.
    await db.kysely.schema.dropTable('runner_widget').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
    const rbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-mig-rb-'))

    let clock = 0
    const runner = new MigrationRunner({
      dir: rbDir,
      current: () => snapshot() as Snapshot,
      now: () => `t${++clock}`
    })

    await runner.generate('init')
    await runner.apply(load, db)

    const rolledBack = await runner.rollback(load, db)
    expect(rolledBack).toEqual(['t1_init'])

    // table is gone again
    const exists = await db.kysely
      .selectFrom('information_schema.tables' as never)
      .select('table_name' as never)
      .where('table_name' as never, '=', 'runner_widget' as never)
      .executeTakeFirst()
    expect(!!exists).toBe(false)

    // ledger no longer marks it applied → it shows as unapplied again
    const status = await runner.status(db)
    expect(status.unapplied).toEqual(['t1_init'])
  })
})
