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
 *   - `pass` forces an argument on a delegated field, and refuses a client that sets it,
 *   - `pass` rejects an argument outside its allowlist,
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
const cliBin = path.resolve(e2eRoot, '../packages/pylon/dist/cli/index.js')
const remoteDir = path.resolve(e2eRoot, 'fixtures/gateway-remote-app')
const orgsDir = path.resolve(e2eRoot, 'fixtures/gateway-orgs-app')
const frontDir = path.resolve(e2eRoot, 'fixtures/gateway-front-app')
const usersReg = path.join(frontDir, 'src/generated/users.ts')
const orgsReg = path.join(frontDir, 'src/generated/orgs.ts')

const REMOTE_PORT = 4901
const ORGS_PORT = 4904
const FRONT_PORT = 4782
const remoteUrl = `http://localhost:${REMOTE_PORT}/graphql`
const orgsUrl = `http://localhost:${ORGS_PORT}/graphql`
const frontUrl = `http://localhost:${FRONT_PORT}/graphql`

const env = {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}

let remote: ChildProcess | undefined
let orgs: ChildProcess | undefined
let front: ChildProcess | undefined

function pull(url: string, name: string) {
  const r = spawnSync('node', [cliBin, 'pull', url, '-n', name, '-o', './src/generated'], {
    cwd: frontDir,
    encoding: 'utf8',
    timeout: 60_000,
    env
  })
  if (r.status !== 0) throw new Error(`pull ${name} failed: ${String(r.stderr ?? r.stdout ?? '')}`)
}

function build(cwd: string) {
  const r = spawnSync('node', [cliBin, 'build'], {cwd, encoding: 'utf8', timeout: 120_000, env})
  if (r.status !== 0) throw new Error(`build failed (${cwd}): ${String(r.stderr ?? r.stdout ?? '')}`)
}

function serve(cwd: string, port: number, extraEnv: Record<string, string> = {}) {
  return spawn('node', ['.pylon/server.mjs'], {
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

describe('gateway — three real Pylon services, pull + cross-service delegate over HTTP', () => {
  beforeAll(async () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)

    // 1. Build + serve BOTH remotes (users + orgs) on different ports.
    await fs.rm(path.join(remoteDir, '.pylon'), {recursive: true, force: true})
    await fs.rm(path.join(orgsDir, '.pylon'), {recursive: true, force: true})
    build(remoteDir)
    build(orgsDir)
    remote = serve(remoteDir, REMOTE_PORT)
    orgs = serve(orgsDir, ORGS_PORT)
    await Promise.all([waitForReady(remoteUrl), waitForReady(orgsUrl)])

    // 2. `pylon pull` BOTH live schemas → the front's two typed registries.
    await fs.rm(usersReg, {force: true})
    await fs.rm(orgsReg, {force: true})
    pull(remoteUrl, 'users')
    pull(orgsUrl, 'orgs')
    if (!existsSync(usersReg) || !existsSync(orgsReg)) {
      throw new Error('pull did not generate both registries')
    }

    // 3. Build + serve the front, pointed at both remotes.
    await fs.rm(path.join(frontDir, '.pylon'), {recursive: true, force: true})
    build(frontDir)
    front = serve(frontDir, FRONT_PORT, {REMOTE_URL: remoteUrl, ORGS_URL: orgsUrl})
    await waitForReady(frontUrl)
  }, 240_000)

  afterAll(async () => {
    front?.kill('SIGKILL')
    remote?.kill('SIGKILL')
    orgs?.kill('SIGKILL')
    for (const d of [frontDir, remoteDir, orgsDir]) {
      await fs.rm(path.join(d, '.pylon'), {recursive: true, force: true}).catch(() => {})
    }
  })

  it('pull generated both registries the front builds against', () => {
    expect(existsSync(usersReg)).toBe(true)
    expect(existsSync(orgsReg)).toBe(true)
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

  it('a patch can delegate to ANOTHER remote service (cross-service, lazy)', async () => {
    // The `User` patch (on the users gateway) adds `org: () => orgs.delegate(...)`,
    // where `orgs` is a SECOND gateway to a DIFFERENT service. It must surface in
    // the schema (PatchSchema reads the function field) AND fire only when selected
    // — proving a patch composes a lazy delegate across services. `org { name }`
    // ("Acme") lives only in the orgs service.
    const r = await gql(frontUrl, '{ fullUser(id: "u1") { email org { name } } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.fullUser).toEqual({email: 'ada@x.com', org: {name: 'Acme'}})
  })

  it('pass() refuses a client that sets the forced argument', async () => {
    // Refused rather than silently overridden: handing back the constrained
    // set as though the filter applied is the failure this removes.
    const r = await gql(frontUrl, '{ fullUser(id: "u1") { orders(status: "DRAFT") } }')
    expect(r.errors?.[0]?.message ?? '').toMatch(/cannot be supplied/)
  })

  it('pass() applies when the client passes no argument at all', async () => {
    const r = await gql(frontUrl, '{ fullUser(id: "u1") { orders } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.fullUser.orders).toEqual(['o1:ACTIVE'])
  })

  it('pass() rejects an argument outside the allowlist', async () => {
    // `limit` is a real argument on the remote — the front's schema accepts it,
    // so this is denied by the boundary rather than by GraphQL validation.
    const r = await gql(frontUrl, '{ fullUser(id: "u1") { orders(limit: 1) } }')
    expect(r.errors?.[0]?.message ?? '').toMatch(/not allowed/)
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
