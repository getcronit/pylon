/**
 * Migration-CLI e2e (DB-backed): drives the shipped `pylon db` commands against
 * the suite's live Postgres — `diff` generates a migration, `migrate` applies it
 * to the database, a second `migrate` is idempotent, and `status` reports it
 * applied. This is the first end-to-end exercise of the `pylon db migrate` path
 * (load models → connect → apply) against a real DB.
 *
 * Postgres is owned by the suite's globalSetup; this test uses distinct `mig_*`
 * tables. Skipped only if Docker is unavailable.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cliBin = path.resolve(dir, '../../packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/migrate-app')
const connectionString = 'postgres://pylon:pylon@localhost:5434/pylon_e2e'
const dockerAvailable = spawnSync('docker', ['--version'], {stdio: 'ignore'}).status === 0

let migrationsDir: string

/** Run `pylon db <args>` in the app, return combined output + status. */
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
      // vitest sets NODE_ENV=test/VITEST, which silences consola in the child —
      // force log output so we can assert on the CLI's messages.
      CONSOLA_LEVEL: '5'
    }
  })
  return {status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`}
}

describe.skipIf(!dockerAvailable)('pylon db (shipped CLI) against a live database', () => {
  beforeAll(async () => {
    if (!existsSync(cliBin)) {
      throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
    }
    migrationsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pylon-mig-e2e-'))
  }, 60_000)

  afterAll(async () => {
    await fs.rm(migrationsDir, {recursive: true, force: true})
  })

  it('db diff generates a migration from the models', () => {
    const r = pylonDb('diff', 'init')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Created migration/)
  })

  it('db migrate applies it to the database', () => {
    const r = pylonDb('migrate')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Applied/)
  })

  it('db migrate is idempotent (second run is a no-op)', () => {
    const r = pylonDb('migrate')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/up to date/i)
  })

  it('db status reports nothing pending or unapplied', () => {
    const r = pylonDb('status')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Uncaptured schema changes:\s*0/)
    expect(r.out).toMatch(/0 unapplied/)
  })

  it('db diff is a no-op when models are unchanged', () => {
    const r = pylonDb('diff', 'again')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/No schema changes/)
  })

  it('db rollback reverses the applied migration', () => {
    const r = pylonDb('rollback')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Rolled back/)

    // the migration now shows as unapplied again (ledger entry removed)
    const status = pylonDb('status')
    expect(status.status, status.out).toBe(0)
    expect(status.out).toMatch(/1 unapplied/)
  })

  it('db migrate re-applies after a rollback', () => {
    const r = pylonDb('migrate')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Applied/)
  })

  it('db plan prints the CREATE TABLE SQL (no apply)', () => {
    const r = pylonDb('plan')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/CREATE TABLE "mig_author"/)
    expect(r.out).toMatch(/ADD CONSTRAINT .*FOREIGN KEY/)
  })

  it('db check passes when everything is captured + applied', () => {
    const r = pylonDb('check')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/Up to date/)
  })

  it('db push syncs the schema directly (idempotent here)', () => {
    const r = pylonDb('push')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/pushed/i)
  })

  it('db migrate --check is a no-op when up to date (models captured, nothing pending)', () => {
    const r = pylonDb('migrate', '--check')
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/up to date/i)
  })
})
