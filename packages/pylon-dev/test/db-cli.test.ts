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
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {runDbCommand} from '../src/db'

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
    expect(body).toContain("import {migrations} from '@getcronit/pylon-db'")
    expect(body).toContain('migrations.defineMigration(')
    expect(body).toContain('migrations.createTable(')
    expect(body).toMatch(/"table":\s*"account"/)
    expect(body).toMatch(/"name":\s*"email"/)
  })

  it('status reports no pending changes once a migration captured them', async () => {
    await runDbCommand({command: 'diff', name: 'init', models: 'models.ts', dir: migrationsDir, cwd: fixtureCwd})
    const res = await runDbCommand({command: 'status', models: 'models.ts', dir: migrationsDir, cwd: fixtureCwd})
    expect(res.status!.pendingChanges).toEqual([])
    expect(res.status!.unapplied).toHaveLength(1)
  })

  it('diff is a no-op when models match the reconstructed baseline', async () => {
    await runDbCommand({command: 'diff', name: 'init', models: 'models.ts', dir: migrationsDir, cwd: fixtureCwd})
    const res = await runDbCommand({command: 'diff', name: 'again', models: 'models.ts', dir: migrationsDir, cwd: fixtureCwd})
    expect(res.created).toBeNull()
  })
})
