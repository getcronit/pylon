/**
 * Cross-app FK retype coordination (RFC phase 2), end to end against Postgres.
 *
 * Two apps: core.Location (uuid PK) and products.InventoryLevel whose location_id is a
 * CROSS-APP FK → core_location.id (its type follows the PK). Flipping PYLON_RETYPE=1
 * retypes the PK uuid → text; the referencing column follows. `db diff` must COORDINATE
 * this — emit products/pre (drop FK + alter), core/retype, products/post (re-add FK),
 * wired by cross-app deps — and `db migrate` must apply it without the 42P07 abort.
 *
 * Verification is by `db check`: it detects out-of-band TYPE drift, so `check` passing
 * against the text models proves the columns actually became text (no raw SQL needed).
 */
import {spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const cliBin = path.resolve(dir, '../../packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/xapp-retype-app')
const DB = 'postgres://pylon:pylon@localhost:5434/pylon_xapp_retype_e2e'

function pylonDb(args: string[], retype = false) {
  const r = spawnSync('node', [cliBin, 'db', ...args], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: DB,
      ...(retype ? {PYLON_RETYPE: '1'} : {}),
      PYLON_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
      CONSOLA_LEVEL: '5'
    }
  })
  return {status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`}
}

const coreMig = path.join(appDir, 'src/apps/core/migrations')
const prodMig = path.join(appDir, 'src/apps/products/migrations')
const cleanDirs = () =>
  Promise.all([
    fs.rm(coreMig, {recursive: true, force: true}),
    fs.rm(prodMig, {recursive: true, force: true})
  ])

beforeAll(async () => {
  if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)
  await cleanDirs()
  // Fresh DB, created by the first migrate via --create-db.
  pylonDb(['reset', '--force']) // no-op if the DB doesn't exist yet; ignored below
}, 60_000)

afterAll(cleanDirs)

describe('cross-app FK retype coordination (Postgres)', () => {
  it('captures the uuid baseline, then coordinates and applies the uuid → text retype', async () => {
    // 1. Baseline (uuid) — create the DB, generate + apply the two apps' inits.
    const init = pylonDb(['diff', 'init'])
    expect(init.status, init.out).toBe(0)
    const migrate1 = pylonDb(['migrate', '--create-db'])
    expect(migrate1.status, migrate1.out).toBe(0)
    // The uuid schema matches the uuid models.
    expect(pylonDb(['check']).status, 'baseline check').toBe(0)

    // 2. Retype: db diff must coordinate the cross-app FK (emit pre/retype/post).
    const diff = pylonDb(['diff', 'retype'], true)
    expect(diff.status, diff.out).toBe(0)
    expect(diff.out).toMatch(/products:.*retype_pre/)
    expect(diff.out).toMatch(/core:.*retype/)
    expect(diff.out).toMatch(/products:.*retype_post/)

    // 3. Apply the coordinated retype — must NOT abort with 42P07.
    const migrate2 = pylonDb(['migrate'], true)
    expect(migrate2.status, migrate2.out).toBe(0)
    expect(migrate2.out).not.toMatch(/cannot be implemented/)

    // 4. The text schema now matches the text models — check passes (type drift would fail it).
    const check = pylonDb(['check'], true)
    expect(check.status, check.out).toBe(0)

    // 5. Coordinated rollback: the newest applied migration belongs to the retype cluster,
    // so `db rollback` reverses the WHOLE cluster as a unit. But `text → uuid` (the retype's
    // down) is not an implicit cast, so the cluster is IRREVERSIBLE — rollback must refuse UP
    // FRONT (nothing rolled back), naming the migration, rather than half-reverting.
    const rollback = pylonDb(['rollback'], true)
    expect(rollback.status, rollback.out).not.toBe(0)
    expect(rollback.out).toMatch(/irreversible/i)
    // Nothing changed — the columns are still text, so check still passes.
    expect(pylonDb(['check'], true).status).toBe(0)
  }, 120_000)
})
