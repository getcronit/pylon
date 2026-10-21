/**
 * `pylon db push` destructive path, end-to-end through the real project-runner bridge (not the engine
 * in isolation): a detect pass reports the orphan column, and an apply pass with a confirmed
 * `dropColumns` plan drops it. This is the subprocess plumbing — `pushPlan` + `syncSchema(opts)` across
 * the bridge — that the parent CLI drives from the interactive prompt / `--force`.
 */
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Client} from 'pg'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {runDbCommand} from '@/cli/db'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixtureCwd = path.join(dir, 'fixtures', 'orm-app')
const DB = process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDbGated = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

async function accountColumns(client: Client): Promise<string[]> {
  const {rows} = await client.query<{column_name: string}>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'account' ORDER BY column_name`
  )
  return rows.map(r => r.column_name)
}

describe.skipIf(!runDbGated)('pylon db push (destructive, via the bridge)', () => {
  const prevUrl = process.env.DATABASE_URL
  let client: Client

  beforeAll(async () => {
    process.env.DATABASE_URL = DB
    client = new Client({connectionString: DB})
    await client.connect()
    await client.query('DROP TABLE IF EXISTS account CASCADE')
    // Additive push creates `account` (id, email, active) from the fixture models.
    await runDbCommand({command: 'push', models: 'models.ts', cwd: fixtureCwd})
    // An orphan column the models don't define, with a row (proves it isn't just empty).
    await client.query('ALTER TABLE account ADD COLUMN IF NOT EXISTS legacy_note text')
    await client.query(`INSERT INTO account (email, legacy_note) VALUES ('a@b.c', 'old')`)
  })

  afterAll(async () => {
    await client?.query('DROP TABLE IF EXISTS account CASCADE').catch(() => {})
    await client?.end()
    if (prevUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevUrl
  })

  it('detect pass reports the orphan column and applies nothing', async () => {
    const res = await runDbCommand({command: 'push', models: 'models.ts', cwd: fixtureCwd, pushDetect: true})
    expect(res.pushed).toBe(false)
    expect(res.pushDrift?.dropColumns).toContainEqual({table: 'account', column: 'legacy_note'})
    // Nothing dropped yet.
    expect(await accountColumns(client)).toContain('legacy_note')
  })

  it('apply pass with a confirmed dropColumns plan drops the orphan', async () => {
    await runDbCommand({
      command: 'push',
      models: 'models.ts',
      cwd: fixtureCwd,
      dropColumns: [{table: 'account', column: 'legacy_note'}]
    })
    expect(await accountColumns(client)).not.toContain('legacy_note')
  })

  it('a plain additive apply keeps an orphan (no accidental data loss)', async () => {
    await client.query('ALTER TABLE account ADD COLUMN IF NOT EXISTS keep_me text')
    await runDbCommand({command: 'push', models: 'models.ts', cwd: fixtureCwd}) // no plan
    expect(await accountColumns(client)).toContain('keep_me')
  })
})
