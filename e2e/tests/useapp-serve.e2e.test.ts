/**
 * Live e2e for the multi-app authz stack (Dockerized): a real running server built
 * from `new Pylon({graphql})` apps + `compose()` + an identity provider +
 * `defineAbilities`. Proves the WHOLE thing end-to-end over HTTP — the path the
 * lokalis migration rests on:
 *   - identity provider → Principal bound for the request,
 *   - tenant auto-scoping (org isolation),
 *   - resource abilities scope ORM reads (own + shared) and authorize writes,
 *   - capability gate (requireRole) on an operation,
 *   - a role-gated REST route,
 * all from one app declaration. Skipped only if Docker is absent.
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
const appDir = path.resolve(e2eRoot, 'fixtures/useapp-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4759
const base = `http://localhost:${PORT}`
const endpoint = `${base}/graphql`
const connectionString = 'postgres://pylon:pylon@localhost:5434/pylon_e2e'
const dockerAvailable = spawnSync('docker', ['--version'], {stdio: 'ignore'}).status === 0

let server: ChildProcess | undefined

const headers = (id?: string, org = 'orgA', role = 'user') =>
  id ? {'x-user-id': id, 'x-org': org, 'x-role': role} : {}

async function gql(
  query: string,
  variables: Record<string, unknown> | undefined,
  h: Record<string, string>
) {
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
    await db.kysely.schema.dropTable('projects_task').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
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

const ids: Record<string, number> = {}

describe.skipIf(!dockerAvailable)('multi-app live — Pylon apps + compose + two-tier authz', () => {
  beforeAll(async () => {
    if (!existsSync(cliBin)) {
      throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
    }
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

    // Seed: u1@orgA owns t1(private) + t2(shared); u2@orgA owns t3; u3@orgB owns t4.
    const create = async (h: Record<string, string>, title: string, shared = false) => {
      const r = await gql(
        'mutation($t:String!,$s:Boolean!){createTask(title:$t,shared:$s){id title}}',
        {t: title, s: shared},
        h
      )
      if (r.errors) throw new Error(`seed ${title}: ${JSON.stringify(r.errors)}`)
      return Number(r.data.createTask.id)
    }
    ids.t1 = await create(headers('u1'), 't1')
    ids.t2 = await create(headers('u1'), 't2-shared', true)
    ids.t3 = await create(headers('u2'), 't3')
    ids.t4 = await create(headers('u3', 'orgB'), 't4-orgB')
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true})
    await resetSchema()
  }, 60_000)

  const titles = async (h: Record<string, string>) => {
    const r = await gql('{tasks{title}}', undefined, h)
    if (r.errors) throw new Error(JSON.stringify(r.errors))
    return r.data.tasks.map((t: any) => t.title).sort()
  }

  it('abilities scope reads: owner sees own + shared, not others', async () => {
    expect(await titles(headers('u1'))).toEqual(['t1', 't2-shared'])
    expect(await titles(headers('u2'))).toEqual(['t2-shared', 't3']) // shared + own, not t1
  })

  it('tenant isolation: orgB sees only its rows; admin is still tenant-bound', async () => {
    expect(await titles(headers('u3', 'orgB'))).toEqual(['t4-orgB'])
    // admin → manage all, but tenant floor keeps it within orgA
    expect(await titles(headers('admin1', 'orgA', 'admin'))).toEqual(['t1', 't2-shared', 't3'])
  })

  it('resource authorize: readable-but-unowned update → FORBIDDEN; owner → ok', async () => {
    // u2 can READ t2 (shared) but not UPDATE it (owned by u1) → FORBIDDEN, not NOT_FOUND.
    const denied = await gql(
      'mutation($id:Number!){renameTask(id:$id,title:"hax"){id}}',
      {id: ids.t2},
      headers('u2')
    )
    expect(denied.errors?.[0].extensions?.code).toBe('FORBIDDEN')

    const ok = await gql(
      'mutation($id:Number!){renameTask(id:$id,title:"t1-edited"){title}}',
      {id: ids.t1},
      headers('u1')
    )
    expect(ok.errors).toBeUndefined()
    expect(ok.data.renameTask.title).toBe('t1-edited')
  })

  it('capability gate: requireRole(admin) on adminClearTasks', async () => {
    const denied = await gql('mutation{adminClearTasks}', undefined, headers('u1'))
    expect(denied.errors?.[0].extensions?.code).toBe('FORBIDDEN')
  })

  it('role-gated REST route: 403 for non-admin, 200 for admin', async () => {
    const u1 = await fetch(`${base}/projects/admin/export`, {headers: headers('u1')})
    expect(u1.status).toBe(403)
    const admin = await fetch(`${base}/projects/admin/export`, {
      headers: headers('admin1', 'orgA', 'admin')
    })
    expect(admin.status).toBe(200)
  })

  it('REST route reads the same bound Principal', async () => {
    const res = await fetch(`${base}/projects/whoami`, {headers: headers('u7', 'orgZ', 'user')})
    expect(await res.json()).toEqual({id: 'u7', org: 'orgZ', roles: ['user']})
  })
})
