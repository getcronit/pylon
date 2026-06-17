/**
 * Polymorphic gateway e2e — turning a FLAT remote type into a GraphQL interface
 * with variant members, resolved per-row, using only existing primitives (NO
 * dedicated `variants` config). Two real CLI-built Pylon services:
 *   - `gateway-poly-remote-app` : a flat `User { id email kind specialty? insuranceId? }`,
 *   - `gateway-poly-front-app`  : declares an interface (base class `Profile`) + two
 *     members, and a gateway patch that stamps `__typename` off `kind`.
 *
 * What this proves end-to-end over HTTP:
 *   - a base class with subclasses emits a GraphQL INTERFACE (`IProfile`) whose
 *     possibleTypes include the members — and the members emit even though they're
 *     referenced ONLY via the base return type + the runtime patch (no discoverability gap),
 *   - a resolver returning the base type is typed as the INTERFACE,
 *   - the patch's stamped `__typename` routes `... on DoctorProfile` / `... on PatientProfile`
 *     (resolveType honors `__typename`), per row,
 *   - variant fields don't bleed across members,
 *   - a nullable interface field delegates a missing row through as null.
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
const remoteDir = path.resolve(e2eRoot, 'fixtures/gateway-poly-remote-app')
const frontDir = path.resolve(e2eRoot, 'fixtures/gateway-poly-front-app')
const reg = path.join(frontDir, 'src/generated/polyusers.ts')

const REMOTE_PORT = 4905
const FRONT_PORT = 4906
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
  return spawn('node', ['.pylon/index.js'], {cwd, stdio: 'ignore', env: {...env, PORT: String(port), ...extraEnv}})
}

async function gql(url: string, query: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
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

describe('gateway — patch a flat remote type into a polymorphic interface', () => {
  beforeAll(async () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)

    // 1. Build + serve the flat remote.
    await fs.rm(path.join(remoteDir, '.pylon'), {recursive: true, force: true})
    build(remoteDir)
    remote = serve(remoteDir, REMOTE_PORT)
    await waitForReady(remoteUrl)

    // 2. `pylon pull` the live remote schema → the front's typed registry.
    await fs.rm(reg, {force: true})
    const pull = spawnSync('node', [cliBin, 'pull', remoteUrl, '-n', 'polyusers', '-o', './src/generated'], {
      cwd: frontDir,
      encoding: 'utf8',
      timeout: 60_000,
      env
    })
    if (pull.status !== 0) throw new Error(`pull failed: ${String(pull.stderr ?? pull.stdout ?? '')}`)
    if (!existsSync(reg)) throw new Error('pull did not generate the registry')

    // 3. Build + serve the polymorphic front.
    await fs.rm(path.join(frontDir, '.pylon'), {recursive: true, force: true})
    build(frontDir)
    front = serve(frontDir, FRONT_PORT, {REMOTE_URL: remoteUrl})
    await waitForReady(frontUrl)
  }, 240_000)

  afterAll(async () => {
    front?.kill('SIGKILL')
    remote?.kill('SIGKILL')
    for (const d of [frontDir, remoteDir]) {
      await fs.rm(path.join(d, '.pylon'), {recursive: true, force: true}).catch(() => {})
    }
  })

  it('emits the base class as an INTERFACE whose possibleTypes include the variant members', async () => {
    const r = await gql(
      frontUrl,
      '{ __type(name:"IProfile") { kind possibleTypes { name } fields { name } } }'
    )
    expect(r.errors).toBeUndefined()
    expect(r.data.__type.kind).toBe('INTERFACE')
    const members = (r.data.__type.possibleTypes as {name: string}[]).map(t => t.name).sort()
    // The members emit even though referenced ONLY via the base return type + the patch.
    expect(members).toEqual(['DoctorProfile', 'PatientProfile', 'Profile'])
    expect((r.data.__type.fields as {name: string}[]).map(f => f.name).sort()).toEqual(['email', 'id'])
  })

  it('types a resolver returning the base type as the interface (nullable)', async () => {
    const r = await gql(
      frontUrl,
      '{ __schema { queryType { fields { name type { kind name } } } } }'
    )
    const profile = (r.data.__schema.queryType.fields as any[]).find(f => f.name === 'profile')
    // nullable interface → the field type IS the interface directly (no NON_NULL wrapper).
    expect(profile.type).toEqual({kind: 'INTERFACE', name: 'IProfile'})
  })

  it('routes a doctor row to DoctorProfile via the patch-stamped __typename', async () => {
    const r = await gql(frontUrl, '{ profile(id:"u1") { __typename id email ... on DoctorProfile { specialty } } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.profile).toEqual({__typename: 'DoctorProfile', id: 'u1', email: 'ada@x.com', specialty: 'Cardiology'})
  })

  it('routes a patient row to PatientProfile (same patch, different variant)', async () => {
    const r = await gql(frontUrl, '{ profile(id:"u2") { __typename id email ... on PatientProfile { insuranceId } } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.profile).toEqual({__typename: 'PatientProfile', id: 'u2', email: 'lin@x.com', insuranceId: 'INS-42'})
  })

  it('does not bleed variant fields across members', async () => {
    // u1 is a doctor — selecting BOTH fragments yields only the doctor field.
    const r = await gql(
      frontUrl,
      '{ profile(id:"u1") { __typename ... on DoctorProfile { specialty } ... on PatientProfile { insuranceId } } }'
    )
    expect(r.errors).toBeUndefined()
    expect(r.data.profile).toEqual({__typename: 'DoctorProfile', specialty: 'Cardiology'})
  })

  it('delegates a missing row through as null (nullable interface field)', async () => {
    const r = await gql(frontUrl, '{ profile(id:"nope") { __typename } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.profile).toBeNull()
  })
})
