/**
 * Authored-migrations e2e (DB-backed): unlike `db-migrate.e2e.test.ts` (which
 * *generates* a migration from the models, then applies it), this drives the
 * shipped `pylon db` commands against a fixture with **committed, hand-written**
 * migration files that exercise all three authoring helpers:
 *   - 0001_init     `runSql` raw-DDL ops with explicit `down`  (schema)
 *   - 0002_seed     `runSql` data migration (INSERT up / DELETE down)
 *   - 0003_backfill `run`   TS code migration (read-then-write via `db`)
 * It asserts real data effects via a direct DB connection, and covers both
 * single-step and multi-step (`--steps`) rollback, then a clean re-apply.
 *
 * Postgres is owned by the suite's globalSetup; this fixture uses `shop_*`
 * tables. Skipped only if Docker is unavailable.
 */
import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {connect, type Database} from '@getcronit/pylon-db'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cliBin = path.resolve(dir, '../../packages/pylon-dev/dist/index.js')
const appDir = path.resolve(dir, '../fixtures/migrations-app')
const migrationsDir = path.join(appDir, 'migrations')
const connectionString = 'postgres://pylon:pylon@localhost:5434/pylon_e2e'
const dockerAvailable = spawnSync('docker', ['--version'], {stdio: 'ignore'}).status === 0

/** Run `pylon db <args>` against the fixture's committed migrations. */
function pylonDb(...args: string[]) {
  const r = spawnSync('node', [cliBin, 'db', ...args, '--dir', migrationsDir], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      PYLON_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
      CONSOLA_LEVEL: '5'
    }
  })
  return {status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`}
}

describe.skipIf(!dockerAvailable)('pylon db — committed/authored migrations (live database)', () => {
  let db: Database

  const categoryNames = async () => {
    const rows = await db.kysely.selectFrom('shop_category' as never).selectAll().execute()
    return (rows as Array<{name: string}>).map(r => r.name).sort()
  }
  const productTitles = async () => {
    const rows = await db.kysely.selectFrom('shop_product' as never).selectAll().execute()
    return (rows as Array<{title: string}>).map(r => r.title).sort()
  }
  const tableExists = async (name: string) => {
    const row = await db.kysely
      .selectFrom('information_schema.tables' as never)
      .select('table_name' as never)
      .where('table_name' as never, '=', name as never)
      .executeTakeFirst()
    return !!row
  }
  const reset = async () => {
    await db.kysely.schema.dropTable('shop_product').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('shop_category').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
  }

  beforeAll(async () => {
    if (!existsSync(cliBin)) {
      throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
    }
    db = connect({connectionString})
    await reset()
  }, 60_000)

  afterAll(async () => {
    if (db) {
      await reset()
      await db.destroy()
    }
  })

  it('status lists the committed migrations as unapplied with no pending changes', () => {
    const r = pylonDb('status')
    expect(r.status, r.out).toBe(0)
    // snapshot.json matches the models → nothing uncaptured
    expect(r.out).toMatch(/Uncaptured schema changes:\s*0/)
    // 0001_init + 0002_seed + 0003_backfill, none applied yet
    expect(r.out).toMatch(/Migrations: 3 \(3 unapplied\)/)
  })

  it('migrate applies all three authoring styles in order (schema/runSql/run)', async () => {
    const r = pylonDb('migrate')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Applied 3 migration\(s\): 0001_init, 0002_seed, 0003_backfill/)
    expect(await tableExists('shop_product')).toBe(true)
    expect(await categoryNames()).toEqual(['Books', 'Toys']) // runSql seed
    expect(await productTitles()).toEqual(['Intro to Pylon']) // run() backfill
  })

  it('status now reports everything applied', () => {
    const r = pylonDb('status')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Migrations: 3 \(0 unapplied\)/)
  })

  it('rollback reverses only the newest migration — the run() code migration', async () => {
    const r = pylonDb('rollback')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Rolled back 1 migration\(s\): 0003_backfill/)
    // the run() handler's `down` removed the product…
    expect(await productTitles()).toEqual([])
    // …while the seeded categories (an earlier migration) remain
    expect(await categoryNames()).toEqual(['Books', 'Toys'])
  })

  it('rollback --steps 2 reverses the seed then the schema, dropping the tables', async () => {
    const r = pylonDb('rollback', '--steps', '2')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Rolled back 2 migration\(s\): 0002_seed, 0001_init/)
    expect(await tableExists('shop_product')).toBe(false)
    expect(await tableExists('shop_category')).toBe(false)
  })

  it('re-applies cleanly after a full rollback', async () => {
    const r = pylonDb('migrate')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Applied 3 migration/)
    expect(await categoryNames()).toEqual(['Books', 'Toys'])
    expect(await productTitles()).toEqual(['Intro to Pylon'])
  })
})
