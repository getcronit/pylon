/**
 * Exercises the `pylon db` model-loading bridge end-to-end (no DB): bundle a
 * real models entry, import it to populate the registry on the project's
 * pylon-orm instance, and drive the migration runner — proving the cross-package
 * wiring works, not just the unit pieces.
 */
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Client} from 'pg'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {runDbCommand} from '@/cli/db'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixtureCwd = path.join(dir, 'fixtures', 'orm-app')

describe('pylon db CLI (model-loading bridge, no DB)', () => {
  let migrationsDir: string

  beforeEach(async () => {
    migrationsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-db-cli-'))
  })
  afterEach(async () => {
    await fs.rm(migrationsDir, {recursive: true, force: true})
  })

  it('diff generates a migration from the loaded models', async () => {
    const res = await runDbCommand({
      command: 'diff',
      name: 'init',
      models: 'models.ts',
      dir: migrationsDir,
      cwd: fixtureCwd
    })
    expect(res.created).toMatch(/_init$/)

    const files = await fs.readdir(migrationsDir)
    // No snapshot.json — the baseline is reconstructed from the migration ops.
    expect(files).not.toContain('snapshot.json')
    // Migrations are TS modules authored against the public API, using the
    // named (Django-style) operations — one call per schema change.
    const migration = files.find(f => f.endsWith('_init.ts'))!
    const body = await fs.readFile(path.join(migrationsDir, migration), 'utf8')
    expect(body).toContain("import {migrations} from '@getcronit/pylon/db'")
    expect(body).toContain('migrations.defineMigration(')
    expect(body).toContain('migrations.createTable(')
    expect(body).toMatch(/"table":\s*"account"/)
    expect(body).toMatch(/"name":\s*"email"/)
  }, 30000)

  it('status reports no pending changes once a migration captured them', async () => {
    await runDbCommand({command: 'diff', name: 'init', models: 'models.ts', dir: migrationsDir, cwd: fixtureCwd})
    const res = await runDbCommand({command: 'status', models: 'models.ts', dir: migrationsDir, cwd: fixtureCwd})
    expect(res.status!.pendingChanges).toEqual([])
    expect(res.status!.unapplied).toHaveLength(1)
  }, 30000)

  it('diff is a no-op when models match the reconstructed baseline', async () => {
    await runDbCommand({command: 'diff', name: 'init', models: 'models.ts', dir: migrationsDir, cwd: fixtureCwd})
    const res = await runDbCommand({command: 'diff', name: 'again', models: 'models.ts', dir: migrationsDir, cwd: fixtureCwd})
    expect(res.created).toBeNull()
  }, 30000)
})

// `baseline` adopts an existing database — it needs a live DB to introspect.
const DB = process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDbGated = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDbGated)('pylon db baseline (live DB adoption)', () => {
  let migrationsDir: string
  let outDir: string
  let outFile: string
  const prevUrl = process.env.DATABASE_URL

  beforeEach(async () => {
    process.env.DATABASE_URL = DB
    migrationsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-baseline-cli-'))
    outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-baseline-out-'))
    outFile = path.join(outDir, 'models.generated.ts')
    // A known table to adopt (push the fixture's `account` model into the DB).
    await runDbCommand({command: 'push', models: 'models.ts', cwd: fixtureCwd})
  })
  afterEach(async () => {
    await fs.rm(migrationsDir, {recursive: true, force: true})
    await fs.rm(outDir, {recursive: true, force: true})
    if (prevUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevUrl
  })

  it('introspects, writes model stubs + an initial migration, and marks it applied', async () => {
    const res = await runDbCommand({
      command: 'baseline',
      models: 'models.ts',
      dir: migrationsDir,
      out: outFile,
      cwd: fixtureCwd
    })
    expect(res.baseline).toBeDefined()
    expect(res.baseline!.tables).toBeGreaterThanOrEqual(1)
    expect(res.baseline!.migration).toMatch(/_baseline$/)

    // Model stubs were written and include the adopted table.
    const stubs = await fs.readFile(outFile, 'utf8')
    expect(stubs).toMatch(/export class Account extends Model/)
    expect(stubs).toMatch(/id = id\(\)/)

    // The migration file exists; and because it was marked applied, `status`
    // reports zero unapplied for it (the DB ledger has the row).
    const files = await fs.readdir(migrationsDir)
    expect(files.some(f => f.endsWith('_baseline.ts'))).toBe(true)
    const status = await runDbCommand({
      command: 'status',
      models: 'models.ts',
      dir: migrationsDir,
      cwd: fixtureCwd
    })
    expect(status.status!.unapplied).toHaveLength(0)
  })
})

// `create` + `reset` operate on the DATABASE itself, so they run against a
// DEDICATED throwaway database each — never the shared `pylon_test` (other test
// files use it in parallel, and `reset` drops the whole public schema).
const adminUrl = (): string => {
  const u = new URL(DB)
  u.pathname = '/postgres'
  return u.toString()
}
const dropDatabase = async (name: string): Promise<void> => {
  const admin = new Client({connectionString: adminUrl()})
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await admin.end()
}
const freshDbName = (tag: string): string =>
  `pylon_cli_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`

describe.skipIf(!runDbGated)('pylon db create + reset (live DB)', () => {
  const prevUrl = process.env.DATABASE_URL
  afterEach(() => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevUrl
  })

  it('create makes a missing database, then no-ops when it exists', async () => {
    const name = freshDbName('create')
    const url = new URL(DB)
    url.pathname = `/${name}`
    process.env.DATABASE_URL = url.toString()
    try {
      const first = await runDbCommand({command: 'create', models: 'models.ts', cwd: fixtureCwd})
      expect(first.database).toEqual({name, created: true})
      const second = await runDbCommand({command: 'create', models: 'models.ts', cwd: fixtureCwd})
      expect(second.database).toEqual({name, created: false})
    } finally {
      await dropDatabase(name)
    }
  }, 60000)

  it('reset drops orphan tables and re-applies migrations from scratch', async () => {
    const name = freshDbName('reset')
    const url = new URL(DB)
    url.pathname = `/${name}`
    const cs = url.toString()
    process.env.DATABASE_URL = cs
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-reset-cli-'))
    try {
      // Create the DB and generate an init migration for the fixture models.
      await runDbCommand({command: 'create', models: 'models.ts', cwd: fixtureCwd})
      await runDbCommand({command: 'diff', name: 'init', models: 'models.ts', dir, cwd: fixtureCwd})

      // Seed an ORPHAN table that no migration knows about (the stale-DB scenario).
      const seed = new Client({connectionString: cs})
      await seed.connect()
      await seed.query('CREATE TABLE orphan_legacy (id int)')
      await seed.end()

      // reset --force: drops the whole schema (orphan + ledger), re-applies init.
      const res = await runDbCommand({
        command: 'reset',
        models: 'models.ts',
        dir,
        runSeed: false,
        force: true,
        cwd: fixtureCwd
      })
      expect(res.applied!.length).toBeGreaterThanOrEqual(1)

      const check = new Client({connectionString: cs})
      await check.connect()
      const orphan = await check.query(`select to_regclass('public.orphan_legacy') is not null as present`)
      const account = await check.query(`select to_regclass('public.account') is not null as present`)
      await check.end()
      expect(orphan.rows[0].present).toBe(false) // orphan wiped
      expect(account.rows[0].present).toBe(true) // re-created by the re-applied migration
    } finally {
      await fs.rm(dir, {recursive: true, force: true})
      await dropDatabase(name)
    }
  }, 60000)
})
