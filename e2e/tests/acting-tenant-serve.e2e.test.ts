/**
 * Live e2e for ACTING-AS-TENANT (rfcs/ACTING_TENANT.md), Dockerized.
 *
 * A privileged principal (SUPER_ADMIN) runs a SINGLE operation as another org by carrying
 * `@inContext(context: { actingTenant })`. The value is UNGATED transport — the app's
 * `useDatabase({operationContext})` gate honours it only for SUPER_ADMIN and rebinds the
 * ambient tenant for that operation. Proven over real HTTP:
 *   - baseline tenant isolation (no acting),
 *   - acting rebinds the tenant so the ORDINARY `products` resolver serves the acted org,
 *   - the gate DENIES a non-privileged caller (a bare value grants nothing),
 *   - the rebind is per-operation and does NOT leak into the next call,
 *   - an acting WRITE lands in the acted org.
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
const appDir = path.resolve(e2eRoot, 'fixtures/acting-tenant-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4771
const endpoint = `http://localhost:${PORT}/graphql`
const connectionString = 'postgres://pylon:pylon@localhost:5434/pylon_e2e'
const dockerAvailable = spawnSync('docker', ['--version'], {stdio: 'ignore'}).status === 0

let server: ChildProcess | undefined

/** Identity headers. `role` gates acting; `org` is the caller's own tenant. */
const headers = (id?: string, org = 'orgA', role = 'user') =>
  id ? {'x-user-id': id, 'x-org': org, 'x-role': role} : {}

/** An operation carrying an acting tenant on `@inContext`, exactly as the compiled client emits it. */
const acting = (query: string, actingTenant: string) => ({
  query: query.replace(
    'query {',
    'query ($__context: String) @inContext(context: $__context) {'
  ),
  variables: {__context: JSON.stringify({actingTenant})}
})

async function gql(
  body: {query: string; variables?: Record<string, unknown>},
  h: Record<string, string>
) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...h},
    body: JSON.stringify(body)
  })
  return (await res.json()) as {data?: any; errors?: {message: string; extensions?: any}[]}
}

async function resetSchema() {
  const db: Database = connect({connectionString})
  try {
    for (const t of ['acting_product', '_pylon_migrations']) {
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

describe.skipIf(!dockerAvailable)('acting-as-tenant live — @inContext(context) + operationContext gate', () => {
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

    server = spawn('node', ['.pylon/server.mjs'], {
      cwd: appDir,
      stdio: 'ignore',
      env: {...process.env, PORT: String(PORT), DATABASE_URL: connectionString}
    })
    await waitForReady()

    // Seed one product per org (no acting → each write lands in the caller's own tenant).
    const seed = async (org: string, name: string, price: number) => {
      const r = await gql(
        {
          query: 'mutation($n:String!,$p:Number!){addProduct(name:$n,price:$p){id name orgId}}',
          variables: {n: name, p: price}
        },
        headers('seed', org, 'user')
      )
      if (r.errors) throw new Error(`seed ${org}/${name}: ${JSON.stringify(r.errors)}`)
    }
    await seed('orgA', 'A-Widget', 10)
    await seed('orgB', 'B-Gadget', 20)
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true}).catch(() => {})
  })

  it('emits the @inContext(context:) directive into the schema', async () => {
    // Without the DEFINITION, a query carrying the directive fails validation before any
    // resolver runs.
    const sdl = await fs.readFile(path.join(pylonDir, 'schema.graphql'), 'utf8')
    expect(sdl).toContain('directive @inContext(')
    expect(sdl).toContain('context: String')
  })

  it('baseline: tenant-scoped reads isolate rows per org (no acting)', async () => {
    const a = await gql({query: 'query { products { name } activeTenant }'}, headers('u1', 'orgA'))
    const b = await gql({query: 'query { products { name } activeTenant }'}, headers('u2', 'orgB'))
    expect(a.data.products.map((p: any) => p.name)).toEqual(['A-Widget'])
    expect(a.data.activeTenant).toBe('orgA')
    expect(b.data.products.map((p: any) => p.name)).toEqual(['B-Gadget'])
    expect(b.data.activeTenant).toBe('orgB')
  })

  it('a SUPER_ADMIN acting as another org sees THAT org through the ordinary resolver', async () => {
    const r = await gql(
      acting('query { products { name } activeTenant }', 'orgB'),
      headers('admin', 'orgA', 'SUPER_ADMIN')
    )
    expect(r.errors).toBeUndefined()
    expect(r.data.activeTenant).toBe('orgB')
    expect(r.data.products.map((p: any) => p.name)).toEqual(['B-Gadget'])
  })

  it('the gate DENIES a non-privileged caller — a bare actingTenant grants nothing', async () => {
    // Same acting request, but the caller lacks SUPER_ADMIN: the value is ignored and the
    // call stays on the caller's own tenant. A bad value must never WIDEN access.
    const r = await gql(
      acting('query { products { name } activeTenant }', 'orgB'),
      headers('u1', 'orgA', 'user')
    )
    expect(r.errors).toBeUndefined()
    expect(r.data.activeTenant).toBe('orgA')
    expect(r.data.products.map((p: any) => p.name)).toEqual(['A-Widget'])
  })

  it('the rebind is per-operation and does NOT leak into the next call', async () => {
    const admin = headers('admin', 'orgA', 'SUPER_ADMIN')
    // Act as orgB…
    const acted = await gql(acting('query { activeTenant }', 'orgB'), admin)
    expect(acted.data.activeTenant).toBe('orgB')
    // …then a plain call from the SAME admin is back on their own org — no ambient stickiness.
    const plain = await gql({query: 'query { activeTenant }'}, admin)
    expect(plain.data.activeTenant).toBe('orgA')
  })

  it('an acting WRITE lands in the acted org', async () => {
    const write = await gql(
      {
        query:
          'mutation ($__context: String) @inContext(context: $__context) ' +
          '{ addProduct(name: "C-Acted", price: 30) { name orgId } }',
        variables: {__context: JSON.stringify({actingTenant: 'orgB'})}
      },
      headers('admin', 'orgA', 'SUPER_ADMIN')
    )
    expect(write.errors).toBeUndefined()
    expect(write.data.addProduct.orgId).toBe('orgB')

    // And it is visible to an ordinary orgB caller — it really landed in orgB.
    const b = await gql({query: 'query { products { name } }'}, headers('u2', 'orgB'))
    expect(b.data.products.map((p: any) => p.name).sort()).toEqual(['B-Gadget', 'C-Acted'])
  })
})
