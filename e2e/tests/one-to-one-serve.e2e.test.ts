/**
 * Serve-time e2e for ONE-TO-ONE relations navigable from BOTH sides:
 *   - Account owns a UNIQUE FK (`userId`) → belongsTo `user` (single),
 *   - User navigates the inverse via `hasOne` → `account` (single, nullable),
 *   - a `hasOne` nested filter (`User where account.balance > N`) compiles,
 *   - the unique FK enforces 1:1 (a second account for the same user fails).
 * Dockerized Postgres; skipped if absent.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {connect, type Database} from '@getcronit/pylon/db'

const dir = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(dir, '..')
const cliBin = path.resolve(e2eRoot, '../packages/pylon-dev/dist/index.js')
const appDir = path.resolve(e2eRoot, 'fixtures/one-to-one-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4775
const endpoint = `http://localhost:${PORT}/graphql`
const connectionString = 'postgres://pylon:pylon@localhost:5434/pylon_e2e'
const dockerAvailable = spawnSync('docker', ['--version'], {stdio: 'ignore'}).status === 0

let server: ChildProcess | undefined

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({query, variables})
  })
  return (await res.json()) as {data?: any; errors?: {message: string}[]}
}

async function resetSchema() {
  const db: Database = connect({connectionString})
  try {
    for (const t of ['account', 'user', '_pylon_migrations']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
  } finally {
    await db.destroy()
  }
}

async function waitForReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({query: '{__typename}'})
      })
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('server did not become ready')
}

let userId: number

describe.skipIf(!dockerAvailable)('one-to-one (both sides: belongsTo + hasOne)', () => {
  beforeAll(async () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)
    await fs.rm(pylonDir, {recursive: true, force: true})

    const build = spawnSync('node', [cliBin, 'build'], {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    if (build.status !== 0) throw new Error(`build failed: ${String(build.stderr ?? build.stdout ?? '')}`)

    await resetSchema()
    const push = spawnSync('node', [cliBin, 'db', 'push'], {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {...process.env, DATABASE_URL: connectionString, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    if (push.status !== 0) throw new Error(`db push failed: ${push.stdout}${push.stderr}`)

    server = spawn('node', ['.pylon/index.js'], {
      cwd: appDir,
      stdio: 'ignore',
      env: {...process.env, PORT: String(PORT), DATABASE_URL: connectionString}
    })
    await waitForReady()

    const u = await gql('mutation($n:String!){addUser(name:$n){id}}', {n: 'Ada'})
    if (u.errors) throw new Error(JSON.stringify(u.errors))
    userId = Number(u.data.addUser.id)
    const a = await gql('mutation($u:Number!,$b:Number!){openAccount(userId:$u,balance:$b){id}}', {
      u: userId,
      b: 500
    })
    if (a.errors) throw new Error(JSON.stringify(a.errors))
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true}).catch(() => {})
  })

  it('inverse side: user.account resolves the single related account', async () => {
    const r = await gql('{users{name account{balance}}}')
    expect(r.errors).toBeUndefined()
    expect(r.data.users).toEqual([{name: 'Ada', account: {balance: 500}}])
  })

  it('owning side: account.user resolves the single related user', async () => {
    const r = await gql(`{richUsers{name account{user{name}}}}`)
    // richUsers filters User by hasOne (account.balance > 100); Ada's is 500.
    expect(r.errors).toBeUndefined()
    expect(r.data.richUsers).toEqual([{name: 'Ada', account: {user: {name: 'Ada'}}}])
  })

  it('unique FK enforces 1:1: a second account for the same user is rejected', async () => {
    const r = await gql('mutation($u:Number!,$b:Number!){openAccount(userId:$u,balance:$b){id}}', {
      u: userId,
      b: 1
    })
    expect(r.errors).toBeDefined() // unique violation on userId
  })
})
