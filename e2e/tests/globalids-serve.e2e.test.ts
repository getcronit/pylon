/**
 * Live e2e for the global-id (`Node`) layer over real HTTP (Dockerized):
 *   - a mutation-created entity comes back with a `gid://pylon/Note/<id>` id,
 *   - list queries return gid ids too,
 *   - the auto-generated root `node(id): Node` refetches any entity by its gid,
 *   - a well-formed-but-absent gid resolves to null (Relay semantics),
 *   - a malformed gid surfaces a BAD_REQUEST error.
 * Skipped only if Docker is absent.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {connect, type Database, decodeSnowflake} from '@getcronit/pylon-db'

const dir = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(dir, '..')
const cliBin = path.resolve(e2eRoot, '../packages/pylon-dev/dist/index.js')
const appDir = path.resolve(e2eRoot, 'fixtures/globalids-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4763
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
  return (await res.json()) as {data?: any; errors?: {message: string; extensions?: any}[]}
}

async function resetSchema() {
  const db: Database = connect({connectionString})
  try {
    for (const t of ['note', '_pylon_nodes', '_pylon_migrations']) {
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

// Namespace `shop` + node id 7 both come from useDatabase config (see fixture).
const GID = /^gid:\/\/shop\/Note\/\d+$/

describe.skipIf(!dockerAvailable)('global ids live — Node interface over HTTP', () => {
  let firstGid: string

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

    // server.mjs is the generated, self-serving Node entry (binds after all
    // routes mount). The config just wires the ORM — no serve plugin.
    server = spawn('node', ['.pylon/server.mjs'], {
      cwd: appDir,
      stdio: 'ignore',
      env: {...process.env, PORT: String(PORT), DATABASE_URL: connectionString}
    })
    await waitForReady()
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true}).catch(() => {})
  })

  it('a created entity comes back with a gid-encoded id (configured namespace)', async () => {
    const r = await gql('mutation($t:String!){addNote(title:$t){id title}}', {t: 'hello'})
    expect(r.errors).toBeUndefined()
    expect(r.data.addNote.title).toBe('hello')
    expect(r.data.addNote.id).toMatch(GID) // gid://shop/Note/<snowflake>
    firstGid = r.data.addNote.id
  })

  it('the snowflake PK embeds the leased node id (0 on a fresh DB)', async () => {
    const raw = firstGid.split('/').pop()!
    expect(decodeSnowflake(raw).nodeId).toBe(0)
  })

  it('list queries return gid ids', async () => {
    await gql('mutation($t:String!){addNote(title:$t){id}}', {t: 'world'})
    const r = await gql('{notes{id title}}')
    expect(r.errors).toBeUndefined()
    expect(r.data.notes.length).toBeGreaterThanOrEqual(2)
    for (const n of r.data.notes) expect(n.id).toMatch(GID)
  })

  it('node(gid) refetches the entity through the auto-generated root field', async () => {
    const r = await gql(
      '{ node(id:$id){ __typename ... on Note { id title } } }'.replace('$id', JSON.stringify(firstGid))
    )
    expect(r.errors).toBeUndefined()
    expect(r.data.node.__typename).toBe('Note')
    expect(r.data.node.id).toBe(firstGid)
    expect(r.data.node.title).toBe('hello')
  })

  it('a hand-written resolver get(gid) works — the ORM decodes the gid on input', async () => {
    const r = await gql(
      '{ note(id:$id){ id title } }'.replace('$id', JSON.stringify(firstGid))
    )
    expect(r.errors).toBeUndefined()
    expect(r.data.note.id).toBe(firstGid) // round-trips back to the same gid on output
    expect(r.data.note.title).toBe('hello')
  })

  it('node(gid) returns null for a well-formed but absent id', async () => {
    const r = await gql('{ node(id:"gid://shop/Note/000000000000000"){ __typename } }')
    expect(r.errors).toBeUndefined()
    expect(r.data.node).toBeNull()
  })

  it('node(malformed) surfaces a BAD_REQUEST error', async () => {
    const r = await gql('{ node(id:"not-a-gid"){ __typename } }')
    expect(r.data?.node ?? null).toBeNull()
    expect(r.errors?.[0]?.extensions?.code).toBe('BAD_REQUEST')
  })
})
