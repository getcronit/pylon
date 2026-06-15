/**
 * Runtime e2e (self-contained, Dockerized): spin up a dedicated Postgres via
 * `e2e/docker-compose.yml`, build a real ORM-backed Pylon app, START the built
 * server against that DB, and fire real GraphQL queries over HTTP.
 *
 * This is the top of the pyramid — it proves the whole stack at RUNTIME (not
 * just schema generation): resolver wrapping, model hydration, both relation
 * directions, and create/get against a live database. The DB is owned by this
 * suite (its own compose, distinct port/name), so it doesn't depend on the
 * ORM's dev container or a manually-set DATABASE_URL.
 *
 * Skipped only if Docker isn't available.
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
const appDir = path.resolve(e2eRoot, 'fixtures/runtime-app')
const migrationsDir = path.join(appDir, 'migrations')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4757
const endpoint = `http://localhost:${PORT}/graphql`
// Postgres is owned by the suite's globalSetup (e2e/docker-compose.yml).
const connectionString = 'postgres://pylon:pylon@localhost:5434/pylon_e2e'

const dockerAvailable = spawnSync('docker', ['--version'], {stdio: 'ignore'}).status === 0

/** Run `pylon db <args>` against the fixture's committed migrations. */
function pylonDb(...args: string[]) {
  const r = spawnSync('node', [cliBin, 'db', ...args, '--dir', migrationsDir], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      PYLON_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
      CONSOLA_LEVEL: '5'
    }
  })
  return {status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`}
}

/** Clean slate for this fixture's tables + ledger (the DB is shared within a run). */
async function resetSchema() {
  const db: Database = connect({connectionString})
  try {
    await db.kysely.schema.dropTable('book').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('author').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('_pylon_migrations').ifExists().cascade().execute()
  } finally {
    await db.destroy()
  }
}

let server: ChildProcess | undefined

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({query, variables})
  })
  const json = (await res.json()) as {data?: any; errors?: any}
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data
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

describe.skipIf(!dockerAvailable)('runtime e2e — built server answers GraphQL via the ORM', () => {
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

    // Provision the schema via the REAL migration path (committed migration +
    // `pylon db deploy`), not syncSchema. deploy enforces prod guards — it
    // refuses on uncaptured model changes or a tampered history — so a green
    // run also proves the committed migration matches the models.
    await resetSchema()
    const deployed = pylonDb('deploy')
    if (deployed.status !== 0) throw new Error(`db deploy failed: ${deployed.out}`)

    server = spawn('node', ['.pylon/index.js'], {
      cwd: appDir,
      stdio: 'ignore',
      env: {...process.env, PORT: String(PORT), DATABASE_URL: connectionString}
    })
    await waitForReady()
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true})
    await resetSchema()
  }, 60_000)

  it('serves introspectable GraphQL', async () => {
    expect((await gql('{ __typename }')).__typename).toBe('Query')
  })

  it('create → get round-trips through the ORM (hydration)', async () => {
    const name = `Ada ${Date.now()}`
    const created = (
      await gql('mutation($n: String!){ createAuthor(name: $n){ id name } }', {n: name})
    ).createAuthor
    expect(created.name).toBe(name)

    const fetched = (
      await gql('query($id: Number!){ author(id: $id){ id name } }', {id: Number(created.id)})
    ).author
    expect(fetched.name).toBe(name)
  })

  it('surfaces a ValidationError as a client-safe BAD_USER_INPUT error (not masked)', async () => {
    // `name` is `Text({min: 2})`; an empty name throws ValidationError in the
    // resolver. useDatabase()'s onExecuteDone hook must rewrite it as a
    // BAD_USER_INPUT GraphQLError carrying the structured issues — NOT let Yoga
    // mask it to "Unexpected error".
    await expect(
      gql('mutation($n: String!){ createAuthor(name: $n){ id } }', {n: ''})
    ).rejects.toThrow(/BAD_USER_INPUT/)

    // and the structured issue (path + code) rides along in extensions
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        query: 'mutation($n: String!){ createAuthor(name: $n){ id } }',
        variables: {n: ''}
      })
    })
    const json = (await res.json()) as {errors?: any[]}
    const ext = json.errors?.[0]?.extensions
    expect(ext?.code).toBe('BAD_USER_INPUT')
    expect(ext?.issues?.[0]).toMatchObject({path: 'name', code: 'length'})
  })

  it('resolves both relation directions at runtime', async () => {
    const name = `Grace ${Date.now()}`
    const author = (await gql('mutation($n: String!){ createAuthor(name: $n){ id } }', {n: name}))
      .createAuthor
    const authorId = Number(author.id)

    const book = (
      await gql('mutation($a: Number!, $t: String!){ addBook(authorId: $a, title: $t){ id title } }', {
        a: authorId,
        t: 'On Computable Numbers'
      })
    ).addBook
    expect(book.title).toBe('On Computable Numbers')

    // hasMany: author → books
    const withBooks = (
      await gql('query($id: Number!){ author(id: $id){ name books { title } } }', {id: authorId})
    ).author
    expect(withBooks.name).toBe(name)
    expect(withBooks.books.map((b: any) => b.title)).toEqual(['On Computable Numbers'])
  })
})
