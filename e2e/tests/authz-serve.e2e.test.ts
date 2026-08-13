/**
 * The COMPREHENSIVE authz e2e (Dockerized): one service composed from two gated
 * apps, exercising every authz mechanism end-to-end over HTTP —
 *   - multiple apps (`crm` + `billing`) composed via `new Pylon().compose(...)`,
 *   - per-app DB models (tenant-scoped, deny-by-default),
 *   - app capability GATES — `crm` needs role 'crm'; `billing` needs role 'billing'
 *     AND the 'billing' FEATURE,
 *   - PBAC permission checks INSIDE resolvers (`crm:export`, `billing:write`),
 *   - resource ABILITIES (owner/shared row reads, instance-`authorize('update')`),
 *   - tenant ISOLATION,
 *   - server-owned column stamping on create (orgId/ownerId).
 * Skipped only if Docker is absent.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {connect, type Database} from '@getcronit/pylon/db'

const dir = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(dir, '..')
const cliBin = path.resolve(e2eRoot, '../packages/pylon/dist/cli/index.js')
const appDir = path.resolve(e2eRoot, 'fixtures/authz-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4762
const endpoint = `http://localhost:${PORT}/graphql`
const connectionString = 'postgres://pylon:pylon@localhost:5434/pylon_e2e'
const dockerAvailable = spawnSync('docker', ['--version'], {stdio: 'ignore'}).status === 0

let server: ChildProcess | undefined

type Who = {org?: string; roles?: string; perms?: string; features?: string}
const H = (id?: string, o: Who = {}): Record<string, string> =>
  id
    ? {
        'x-user-id': id,
        'x-org': o.org ?? 'orgA',
        'x-role': o.roles ?? '',
        'x-perm': o.perms ?? '',
        'x-features': o.features ?? ''
      }
    : {}

async function gql(query: string, h: Record<string, string>, variables?: Record<string, unknown>) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...h},
    body: JSON.stringify({query, variables})
  })
  return (await res.json()) as {data?: any; errors?: {message: string; extensions?: any}[]}
}
const code = (r: {errors?: {extensions?: any}[]}) => r.errors?.[0]?.extensions?.code

async function resetSchema() {
  const db: Database = connect({connectionString})
  try {
    for (const t of ['crm_contact', 'billing_invoice', '_pylon_migrations']) {
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

// Full-access actors (used to seed).
const U1 = H('u1', {roles: 'crm,billing', perms: 'crm:export,billing:write', features: 'billing'})
const U2 = H('u2', {roles: 'crm'}) // crm member, no export perm, no billing
const U3 = H('u3', {org: 'orgB', roles: 'crm,billing', perms: 'billing:write', features: 'billing'})
const ADMIN = H('admin', {roles: 'admin,crm,billing', perms: 'crm:export,billing:write', features: 'billing'})

const cid: Record<string, number> = {}

describe.skipIf(!dockerAvailable)('comprehensive authz — 2 apps + gates + abilities + PBAC + tenant', () => {
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

    const addContact = async (h: Record<string, string>, name: string, shared = false) => {
      const r = await gql(
        'mutation($n:String!,$s:Boolean!){addContact(name:$n,shared:$s){id}}',
        h,
        {n: name, s: shared}
      )
      if (r.errors) throw new Error(`seed ${name}: ${JSON.stringify(r.errors)}`)
      return Number(r.data.addContact.id)
    }
    cid.alice = await addContact(U1, 'Alice') // orgA, owner u1
    cid.bob = await addContact(U1, 'Bob', true) // orgA, owner u1, SHARED
    cid.carol = await addContact(U2, 'Carol') // orgA, owner u2
    await addContact(U3, 'Dave') // orgB, owner u3

    const inv = await gql('mutation{issueInvoice(amount:100){id}}', U1) // orgA invoice
    if (inv.errors) throw new Error(`seed invoice: ${JSON.stringify(inv.errors)}`)
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true}).catch(() => {})
  })

  const names = async (h: Record<string, string>) => {
    const r = await gql('{contacts{name}}', h)
    if (r.errors) throw new Error(JSON.stringify(r.errors))
    return r.data.contacts.map((c: any) => c.name)
  }

  // ── app capability gates ──────────────────────────────────────────────────
  it('crm gate: a caller without the role is FORBIDDEN', async () => {
    expect(code(await gql('{contacts{name}}', H('nobody', {roles: 'user'})))).toBe('FORBIDDEN')
  })

  it('billing gate: missing the role → FORBIDDEN (before the feature is checked)', async () => {
    const r = await gql('{invoices{amount}}', H('x', {roles: 'crm', features: 'billing'}))
    expect(code(r)).toBe('FORBIDDEN')
  })

  it('billing gate: role ok but feature OFF → FEATURE_DISABLED', async () => {
    const r = await gql('{invoices{amount}}', H('x', {roles: 'billing'})) // no x-features
    expect(code(r)).toBe('FEATURE_DISABLED')
  })

  it('billing gate: role + feature → allowed', async () => {
    const r = await gql('{invoices{amount}}', U1)
    expect(r.errors).toBeUndefined()
    expect(r.data.invoices.map((i: any) => i.amount)).toEqual([100])
  })

  // ── resource abilities (row reads) ────────────────────────────────────────
  it('abilities: owner sees own + shared; admin sees all in tenant', async () => {
    expect(await names(U1)).toEqual(['Alice', 'Bob']) // own
    expect(await names(U2)).toEqual(['Bob', 'Carol']) // shared Bob + own Carol
    expect(await names(ADMIN)).toEqual(['Alice', 'Bob', 'Carol']) // manage all (orgA)
  })

  it('tenant isolation: orgB sees only its own rows', async () => {
    expect(await names(U3)).toEqual(['Dave'])
    expect((await gql('{invoices{amount}}', U3)).data.invoices).toEqual([]) // no orgB invoice
  })

  // ── instance-level resource authorize ─────────────────────────────────────
  it("resource authorize: non-owner update is FORBIDDEN; owner's succeeds", async () => {
    // u2 can READ Bob (shared) but isn't the owner → instance authorize('update') denies.
    const r = await gql('mutation($id:Number!){renameContact(id:$id,name:"x"){id}}', U2, {id: cid.bob})
    expect(code(r)).toBe('FORBIDDEN')
    const ok = await gql('mutation($id:Number!){renameContact(id:$id,name:"Alice2"){name}}', U1, {
      id: cid.alice
    })
    expect(ok.errors).toBeUndefined()
    expect(ok.data.renameContact.name).toBe('Alice2')
  })

  // ── PBAC permission checks inside resolvers ───────────────────────────────
  it('PBAC: crm member without crm:export is FORBIDDEN; with it succeeds', async () => {
    expect(code(await gql('mutation{exportContacts}', U2))).toBe('FORBIDDEN')
    const ok = await gql('mutation{exportContacts}', U1)
    expect(ok.errors).toBeUndefined()
    expect(typeof ok.data.exportContacts).toBe('number')
  })

  it('PBAC: billing member without billing:write cannot issue', async () => {
    const r = await gql('mutation{issueInvoice(amount:5){id}}', H('nw', {roles: 'billing', features: 'billing'}))
    expect(code(r)).toBe('FORBIDDEN')
  })

  // ── create stamping (server-owned columns) ────────────────────────────────
  it('create stamps orgId/ownerId from the principal (not input)', async () => {
    // admin (manage all) reads every orgA contact; Carol was created by u2.
    const r = await gql('{contacts{name orgId ownerId}}', ADMIN)
    const carol = r.data.contacts.find((c: any) => c.name === 'Carol')
    expect(carol?.orgId).toBe('orgA')
    expect(carol?.ownerId).toBe('u2')
  })
})
