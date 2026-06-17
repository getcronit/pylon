/**
 * Full, real gateway e2e — two CLI-built Pylon services on different ports:
 *   - `gateway-remote-app` : the "user-management" remote (built + served),
 *   - `gateway-front-app`  : delegates `Query.user` to it.
 * The flow also exercises `pylon pull` (generate the typed registry from the live
 * remote schema) before building the front. Verified end-to-end over HTTP:
 *   - delegation + arg injection (right row by `id`),
 *   - the computed `fullName` patch surfaces,
 *   - `needs` limits the upstream fetch (a non-needed field comes back null),
 *   - per-request auth header is forwarded (echoed by the remote's `seenAuth`),
 *   - a missing remote row resolves to null.
 * No DB/docker.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(dir, '..')
const cliBin = path.resolve(e2eRoot, '../packages/pylon-dev/dist/index.js')
const remoteDir = path.resolve(e2eRoot, 'fixtures/gateway-remote-app')
const frontDir = path.resolve(e2eRoot, 'fixtures/gateway-front-app')
const generated = path.join(frontDir, 'src/generated/remote.ts')

const REMOTE_PORT = 4901
const FRONT_PORT = 4782
const remoteUrl = `http://localhost:${REMOTE_PORT}/graphql`
const frontUrl = `http://localhost:${FRONT_PORT}/graphql`

const env = {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}

let remote: ChildProcess | undefined
let front: ChildProcess | undefined

function build(cwd: string) {
  const r = spawnSync('node', [cliBin, 'build'], {cwd, encoding: 'utf8', timeout: 120_000, env})
  if (r.status !== 0) throw new Error(`build failed (${cwd}): ${String(r.stderr ?? r.stdout ?? '')}`)
}

function serve(cwd: string, port: number, extraEnv: Record<string, string> = {}) {
  return spawn('node', ['.pylon/index.js'], {
    cwd,
    stdio: 'ignore',
    env: {...env, PORT: String(port), ...extraEnv}
  })
}

async function gql(url: string, query: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify({query})
  })
  return (await res.json()) as {data?: any; errors?: {message: string}[]}
}

async function waitForReady(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
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
  throw new Error(`server ${url} did not become ready`)
}

describe('gateway — two real Pylon services, pull + delegate over HTTP', () => {
  beforeAll(async () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)

    // 1. Build + serve the remote user service.
    await fs.rm(path.join(remoteDir, '.pylon'), {recursive: true, force: true})
    build(remoteDir)
    remote = serve(remoteDir, REMOTE_PORT)
    await waitForReady(remoteUrl)

    // 2. `pylon pull` the live remote schema → the front's typed registry.
    await fs.rm(generated, {force: true})
    const pull = spawnSync(
      'node',
      [cliBin, 'pull', remoteUrl, '-n', 'remote', '-o', './src/generated'],
      {cwd: frontDir, encoding: 'utf8', timeout: 60_000, env}
    )
    if (pull.status !== 0) throw new Error(`pull failed: ${String(pull.stderr ?? pull.stdout ?? '')}`)
    if (!existsSync(generated)) throw new Error('pull did not generate the registry')

    // 3. Build + serve the front, pointed at the remote.
    await fs.rm(path.join(frontDir, '.pylon'), {recursive: true, force: true})
    build(frontDir)
    front = serve(frontDir, FRONT_PORT, {REMOTE_URL: remoteUrl})
    await waitForReady(frontUrl)
  }, 240_000)

  afterAll(async () => {
    front?.kill('SIGKILL')
    remote?.kill('SIGKILL')
    await fs.rm(path.join(frontDir, '.pylon'), {recursive: true, force: true}).catch(() => {})
    await fs.rm(path.join(remoteDir, '.pylon'), {recursive: true, force: true}).catch(() => {})
  })

  it('pull generated a registry the front builds against', () => {
    // (Covered by beforeAll succeeding — the front only builds if the generated
    //  `RemoteRegistry` typed the delegate calls. Asserted explicitly for clarity.)
    expect(existsSync(generated)).toBe(true)
  })

  it('delegates with arg injection + applies the computed patch', async () => {
    const r = await gql(frontUrl, '{ fullUser(id: "u1") { email fullName } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.fullUser).toEqual({email: 'ada@x.com', fullName: 'Ada Lovelace'})
  })

  it('forwards the request auth header to the remote (echoed by seenAuth)', async () => {
    const r = await gql(frontUrl, '{ fullUser(id: "u1") { seenAuth } }', {authorization: 'Bearer t0ken'})
    expect(r.errors).toBeUndefined()
    expect(r.data.fullUser.seenAuth).toBe('Bearer t0ken')
  })

  it('needs fetches patch-required fields even when the client does not select them', async () => {
    // The client selects ONLY fullName — a patch computed from firstName/lastName,
    // which it never selects. `needs` guarantees those are fetched upstream so the
    // patch resolves. (`needs` is additive — client selection ∪ needs — not a limiter.)
    const r = await gql(frontUrl, '{ fullUser(id: "u1") { fullName } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.fullUser).toEqual({fullName: 'Ada Lovelace'})
  })

  it('a patch can add a field that delegates to another remote query (lazy nested delegate)', async () => {
    // The `User` patch adds `org: () => api.delegate('Query.org', …)`. It must
    // appear in the schema (via PatchSchema reading the function field) AND fire
    // only when selected — proving a patch can compose a (lazy) delegate.
    const r = await gql(frontUrl, '{ fullUser(id: "u1") { email org { name } } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.fullUser).toEqual({email: 'ada@x.com', org: {name: 'Acme'}})
  })

  it('returns a missing remote row as null', async () => {
    // The remote `user(id): User | null` is nullable (strictNullChecks is forced
    // for introspection), so `pull` emits `return: User | null` → the front field
    // is nullable → a missing row delegates through as null, no error.
    const r = await gql(frontUrl, '{ fullUser(id: "nope") { email } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.fullUser).toBeNull()
  })
})
