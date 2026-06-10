import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {pathToFileURL} from 'node:url'
import {sql} from 'kysely'
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

    const generated = await runner.generate('init', load)
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

    const status = await runner.status(load, db)
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

    await runner.generate('init', load)
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
    const status = await runner.status(load, db)
    expect(status.unapplied).toEqual(['t1_init'])
  })

  it('refuses to apply when an applied migration was tampered with (checksum)', async () => {
    await db.kysely.schema.dropTable('runner_widget').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
    const tdir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-mig-cs-'))
    let clock = 0
    const runner = new MigrationRunner({
      dir: tdir,
      current: () => snapshot() as Snapshot,
      now: () => `t${++clock}`
    })

    await runner.generate('init', load)
    await runner.apply(load, db)

    // simulate editing the applied migration: corrupt its stored checksum
    await sql`UPDATE _pylon_migrations SET checksum = 'tampered' WHERE name = 't1_init'`.execute(
      db.kysely
    )

    await expect(runner.apply(load, db)).rejects.toThrow(/modified after it was applied/i)
  })

  it('squash collapses an all-applied schema history and reconciles the ledger', async () => {
    await db.kysely.schema.dropTable('runner_widget').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
    const sdir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-mig-sq-'))

    const idField = {
      name: 'id',
      type: {kind: 'scalar' as const, name: 'ID', nullable: false},
      exposed: true,
      column: {name: 'id', sqlType: 'bigint' as const, primaryKey: true, autoIncrement: true, unique: false, nullable: false}
    }
    const labelField = {
      name: 'label',
      type: {kind: 'scalar' as const, name: 'String', nullable: false},
      exposed: true,
      column: {name: 'label', sqlType: 'text' as const, primaryKey: false, autoIncrement: false, unique: false, nullable: false}
    }
    const snap = (fields: unknown[]): Snapshot => ({
      version: 1,
      entities: {
        RunnerWidget: {name: 'RunnerWidget', table: 'runner_widget', abstract: false, primaryKey: 'id', implements: [], fields: fields as never}
      }
    })

    let clock = 0
    let cur = snap([idField])
    const runner = new MigrationRunner({dir: sdir, current: () => cur, now: () => `s${++clock}`})

    await runner.generate('init', load)
    await runner.apply(load, db)
    cur = snap([idField, labelField])
    await runner.generate('label', load)
    await runner.apply(load, db)

    const res = await runner.squash(load, 'sq', db)
    expect(res!.replaced).toEqual(['s1_init', 's2_label'])
    expect(await runner.list()).toEqual([res!.name])

    // ledger reconciled: the squashed migration is recorded applied, so a fresh
    // apply is a no-op (it does NOT try to re-create the existing tables).
    expect(await runner.apply(load, db)).toEqual([])
    const status = await runner.status(load, db)
    expect(status.unapplied).toEqual([])
    expect(status.pendingChanges).toEqual([])

    await fs.rm(sdir, {recursive: true, force: true})
  })
})
