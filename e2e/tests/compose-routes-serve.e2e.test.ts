/**
 * Serve-time e2e for `compose` route mounting + per-app `basePath`. Two apps each
 * register Hono routes and mount at their own prefix (`/vault`, `/admin`); their
 * GraphQL fragments merge to the single root `/graphql`. Verifies over HTTP that:
 *   - each app's route is reachable at its PREFIX (`/vault/ping`, `/admin/ping`),
 *   - the unprefixed path is NOT mounted (`/ping` → 404),
 *   - one merged schema serves BOTH apps' queries at `/graphql`.
 * No DB — pure core composition.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(dir, '..')
const cliBin = path.resolve(e2eRoot, '../packages/pylon/dist/cli/index.js')
const appDir = path.resolve(e2eRoot, 'fixtures/compose-routes-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4771
const base = `http://localhost:${PORT}`

let server: ChildProcess | undefined

async function waitForReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/graphql`, {
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

  server = spawn('node', ['.pylon/index.js'], {
    cwd: appDir,
    stdio: 'ignore',
    env: {...process.env, PORT: String(PORT)}
  })
  await waitForReady()
}, 180_000)

afterAll(async () => {
  server?.kill('SIGKILL')
  await fs.rm(pylonDir, {recursive: true, force: true}).catch(() => {})
})

describe('compose route mounting + basePath', () => {
  it('mounts each app at its basePath prefix', async () => {
    expect(await (await fetch(`${base}/vault/ping`)).text()).toBe('vault-pong')
    expect(await (await fetch(`${base}/admin/ping`)).text()).toBe('admin-pong')
  })

  it('does NOT mount the route at the unprefixed path', async () => {
    expect((await fetch(`${base}/ping`)).status).toBe(404)
  })

  it('prefix-scoped route guard: throwing ForbiddenError → 403 (not 500); key → 200', async () => {
    expect((await fetch(`${base}/vault/files/42`)).status).toBe(403) // no x-key
    const ok = await fetch(`${base}/vault/files/42`, {headers: {'x-key': 'secret'}})
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('file-42')
  })

  it('a PUBLIC route under the same prefix is NOT gated', async () => {
    const res = await fetch(`${base}/vault/webhook`) // no x-key, outside /files/*
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('webhook-ok')
  })

  it('merges both apps GraphQL fragments into one /graphql', async () => {
    const res = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({query: '{vaultStatus adminStatus}'})
    })
    const body = (await res.json()) as {data?: {vaultStatus: string; adminStatus: string}; errors?: unknown}
    expect(body.errors).toBeUndefined()
    expect(body.data).toEqual({vaultStatus: 'vault-ok', adminStatus: 'admin-ok'})
  })
})
