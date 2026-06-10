/**
 * Authored-migrations e2e (DB-backed): unlike `db-migrate.e2e.test.ts` (which
 * *generates* a migration from the models, then applies it), this drives the
 * shipped `pylon db` commands against a fixture with **committed, hand-written**
 * migration files that exercise all three authoring helpers:
 *   - 0001_init     named schema ops (createTable / addForeignKey)
 *   - 0002_seed     `runSql` data migration (INSERT up / DELETE down)
 *   - 0003_backfill `run` using HISTORICAL models (models.get(...).objects) —
 *                   reconstructed from 0001, never importing the live classes
 *   - 0004_index    `addIndex` named op (Django-style, built-in reverse)
 * It asserts real data + schema effects via a direct DB connection, and covers
 * both single-step and multi-step (`--steps`) rollback, then a clean re-apply.
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
  // Each assertion opens a SHORT-LIVED connection rather than holding one pool
  // across the suite: between assertions we spawn ~10s CLI processes, and an
  // idle pooled client gets evicted (~10s) and breaks the next query.
  const withDb = async <T>(fn: (db: Database) => Promise<T>): Promise<T> => {
    const db = connect({connectionString})
    try {
      return await fn(db)
    } finally {
      await db.destroy()
    }
  }

  const categoryNames = () =>
    withDb(async db => {
      const rows = await db.kysely.selectFrom('shop_category' as never).selectAll().execute()
      return (rows as Array<{name: string}>).map(r => r.name).sort()
    })
  const productTitles = () =>
    withDb(async db => {
      const rows = await db.kysely.selectFrom('shop_product' as never).selectAll().execute()
      return (rows as Array<{title: string}>).map(r => r.title).sort()
    })
  const tableExists = (name: string) =>
    withDb(async db =>
      !!(await db.kysely
        .selectFrom('information_schema.tables' as never)
        .select('table_name' as never)
        .where('table_name' as never, '=', name as never)
        .executeTakeFirst())
    )
  const indexExists = (name: string) =>
    withDb(async db =>
      !!(await db.kysely
        .selectFrom('pg_indexes' as never)
        .select('indexname' as never)
        .where('indexname' as never, '=', name as never)
        .executeTakeFirst())
    )
  const reset = () =>
    withDb(async db => {
      await db.kysely.schema.dropTable('shop_product').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('shop_category').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
    })

  beforeAll(async () => {
    if (!existsSync(cliBin)) {
      throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
    }
    await reset()
  }, 60_000)

  afterAll(async () => {
    await reset()
  })

  it('status lists the committed migrations as unapplied with no pending changes', () => {
    const r = pylonDb('status')
    expect(r.status, r.out).toBe(0)
    // snapshot.json matches the models → nothing uncaptured
    expect(r.out).toMatch(/Uncaptured schema changes:\s*0/)
    // 0001_init + 0002_seed + 0003_backfill + 0004_index, none applied yet
    expect(r.out).toMatch(/Migrations: 4 \(4 unapplied\)/)
  })

  it('migrate applies all four authoring styles in order (runSql/run/addIndex)', async () => {
    const r = pylonDb('migrate')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(
      /Applied 4 migration\(s\): 0001_init, 0002_seed, 0003_backfill, 0004_index/
    )
    expect(await tableExists('shop_product')).toBe(true)
    expect(await categoryNames()).toEqual(['Books', 'Toys']) // runSql seed
    expect(await productTitles()).toEqual(['Intro to Pylon']) // run() backfill
    expect(await indexExists('shop_product_title_idx')).toBe(true) // addIndex
  })

  it('status now reports everything applied', () => {
    const r = pylonDb('status')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Migrations: 4 \(0 unapplied\)/)
  })

  it('rollback reverses only the newest migration — the addIndex op drops the index', async () => {
    const r = pylonDb('rollback')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Rolled back 1 migration\(s\): 0004_index/)
    // addIndex's built-in reverse dropped the index…
    expect(await indexExists('shop_product_title_idx')).toBe(false)
    // …while the row written by the run() migration is untouched
    expect(await productTitles()).toEqual(['Intro to Pylon'])
  })

  it('rollback --steps 3 reverses run/runSql/schema together, dropping the tables', async () => {
    const r = pylonDb('rollback', '--steps', '3')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(
      /Rolled back 3 migration\(s\): 0003_backfill, 0002_seed, 0001_init/
    )
    expect(await tableExists('shop_product')).toBe(false)
    expect(await tableExists('shop_category')).toBe(false)
  })

  it('re-applies cleanly after a full rollback', async () => {
    const r = pylonDb('migrate')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Applied 4 migration/)
    expect(await categoryNames()).toEqual(['Books', 'Toys'])
    expect(await productTitles()).toEqual(['Intro to Pylon'])
    expect(await indexExists('shop_product_title_idx')).toBe(true)
  })

  it('check fails when the live DB drifts from the models', async () => {
    // fully applied + in sync at this point
    expect(pylonDb('check').status).toBe(0)

    // introduce drift: drop a column the models still declare
    await withDb(db =>
      db.kysely.schema.alterTable('shop_product').dropColumn('title').execute()
    )

    const r = pylonDb('check')
    expect(r.status, r.out).toBe(1)
    expect(r.out).toMatch(/missing|drift/i)
  })
})
