/**
 * Live e2e for the NEW multi-app model (Dockerized): apps are `new Pylon({graphql,
 * gate})` with name-tagged DB models, composed by `new Pylon().compose(...)`. No
 * defineApp / useApp / .resolvers. Proves both authz layers fire over real HTTP:
 *   - the app's CAPABILITY gate (requireRole) blocks a caller without the role,
 *   - the app's TENANT-scoped models isolate rows per org,
 *   - an UNGATED app (blog) coexists and stays reachable.
 * Skipped only if Docker is absent.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {connect, type Database} from '@getcronit/pylon-db'

const dir = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(dir, '..')
const cliBin = path.resolve(e2eRoot, '../packages/pylon-dev/dist/index.js')
const appDir = path.resolve(e2eRoot, 'fixtures/apps-db-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4761
const endpoint = `http://localhost:${PORT}/graphql`
const connectionString = 'postgres://pylon:pylon@localhost:5434/pylon_e2e'
const dockerAvailable = spawnSync('docker', ['--version'], {stdio: 'ignore'}).status === 0

let server: ChildProcess | undefined

const headers = (id?: string, org = 'orgA', role = 'user') =>
  id ? {'x-user-id': id, 'x-org': org, 'x-role': role} : {}

async function gql(query: string, h: Record<string, string>, variables?: Record<string, unknown>) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...h},
    body: JSON.stringify({query, variables})
  })
  return (await res.json()) as {data?: any; errors?: {message: string; extensions?: any}[]}
}

async function resetSchema() {
  const db: Database = connect({connectionString})
  try {
    for (const t of ['shop_product', 'blog_post', '_pylon_migrations']) {
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

describe.skipIf(!dockerAvailable)('multi-app live — Pylon apps + gate + tenant DB', () => {
  beforeAll(async () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)
    await fs.rm(pylonDir, {recursive: true, force: true})

    const build = spawnSync('node', [cliBin, 'build'], {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    if (build.status !== 0) throw new Error(`build failed: ${String(build.stderr ?? build.stdout ?? "")}`)

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

    // Seed across two orgs (addProduct is gated → caller needs the 'shop' role).
    const add = async (org: string, name: string, price: number) => {
      const r = await gql(
        'mutation($n:String!,$p:Number!){addProduct(name:$n,price:$p){id name}}',
        headers('seed', org, 'shop'),
        {n: name, p: price}
      )
      if (r.errors) throw new Error(`seed ${org}/${name}: ${JSON.stringify(r.errors)}`)
    }
    await add('orgA', 'A-Widget', 10)
    await add('orgB', 'B-Gadget', 20)
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true}).catch(() => {})
  })

  it('capability gate DENIES a caller without the role', async () => {
    const r = await gql('{products{name}}', headers('u1', 'orgA', 'user')) // no 'shop'
    expect(r.data?.products).toBeUndefined()
    expect(r.errors?.[0]?.extensions?.code).toBe('FORBIDDEN')
  })

  it('capability gate ALLOWS the role', async () => {
    const r = await gql('{products{name}}', headers('u1', 'orgA', 'shop'))
    expect(r.errors).toBeUndefined()
    expect(Array.isArray(r.data.products)).toBe(true)
  })

  it('tenant-scoped models isolate rows per org', async () => {
    const a = await gql('{products{name}}', headers('u1', 'orgA', 'shop'))
    const b = await gql('{products{name}}', headers('u2', 'orgB', 'shop'))
    expect(a.data.products.map((p: any) => p.name)).toEqual(['A-Widget'])
    expect(b.data.products.map((p: any) => p.name)).toEqual(['B-Gadget'])
  })

  it('an UNGATED app (blog) is reachable without the shop role', async () => {
    const r = await gql('{posts{title}}', headers('u1', 'orgA', 'user'))
    expect(r.errors).toBeUndefined()
    expect(Array.isArray(r.data.posts)).toBe(true)
  })
})
