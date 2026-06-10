/**
 * Multi-app e2e (Dockerized): a Pylon host composed of TWO modular apps —
 * `blog` (Author, Article) and `shop` (Product, Purchase, with a CROSS-APP FK
 * Purchase.buyer → blog.Author). Proves the whole apps story at runtime:
 *   - one composed GraphQL schema from two apps' resolver fragments,
 *   - per-app migrations applied by `pylon db deploy` in dependency order
 *     (blog before shop) with a namespaced ledger,
 *   - a query that traverses the cross-app relation over HTTP.
 *
 * Postgres is owned by the suite's globalSetup. Skipped only if Docker is absent.
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
const appDir = path.resolve(e2eRoot, 'fixtures/apps-app')
const migrationsDir = path.join(appDir, 'migrations')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4758
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
  const json = (await res.json()) as {data?: any; errors?: any}
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data
}

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

async function resetSchema() {
  const db: Database = connect({connectionString})
  try {
    for (const t of ['shop_purchase', 'shop_product', 'blog_article', 'blog_author']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
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

describe.skipIf(!dockerAvailable)('multi-app e2e — two apps compose one schema + per-app migrations', () => {
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
    if (build.status !== 0) throw new Error(`build failed: ${build.stderr || build.stdout}`)

    // Per-app migrations applied in dependency order (blog → shop).
    await resetSchema()
    const deployed = pylonDb('deploy')
    if (deployed.status !== 0) throw new Error(`db deploy failed: ${deployed.out}`)
    // deploy logs each app it deployed
    expect(deployed.out).toMatch(/app blog: deployed/i)
    expect(deployed.out).toMatch(/app shop: deployed/i)

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

  it('serves one schema composed from both apps (blog + shop operations exist)', async () => {
    expect((await gql('{ __typename }')).__typename).toBe('Query')

    const author = (await gql('mutation($n:String!){ createAuthor(name:$n){ id name } }', {n: 'Ada'}))
      .createAuthor
    expect(author.name).toBe('Ada')

    const product = (
      await gql('mutation($t:String!,$p:Number!){ addProduct(title:$t, price:$p){ id title price } }', {
        t: 'Widget',
        p: 25
      })
    ).addProduct
    expect(product.title).toBe('Widget')
  })

  it('traverses the CROSS-APP relation (shop.Purchase.buyer → blog.Author) over HTTP', async () => {
    const author = (await gql('mutation($n:String!){ createAuthor(name:$n){ id } }', {n: 'Grace'}))
      .createAuthor
    const product = (
      await gql('mutation($t:String!,$p:Number!){ addProduct(title:$t, price:$p){ id } }', {
        t: 'Compiler',
        p: 100
      })
    ).addProduct

    const purchase = (
      await gql('mutation($pid:Number!,$bid:Number!){ buy(productId:$pid, buyerId:$bid){ id } }', {
        pid: Number(product.id),
        bid: Number(author.id)
      })
    ).buy

    // buyer lives in blog, product in shop — one query crosses both apps.
    const full = (
      await gql('query($id:Number!){ purchase(id:$id){ buyer { name } product { title price } } }', {
        id: Number(purchase.id)
      })
    ).purchase
    expect(full.buyer.name).toBe('Grace')
    expect(full.product).toMatchObject({title: 'Compiler', price: 100})
  })

  it('mounts an app-contributed Hono route (REST, not GraphQL)', async () => {
    const res = await fetch(`http://localhost:${PORT}/blog/ping`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('blog-pong')
  })

  it('enforces a cross-app FK + app-level validation through the API', async () => {
    // dangling buyerId → blog_author FK violation (masked server error, not data)
    await expect(
      gql('mutation{ buy(productId: 999999, buyerId: 999999){ id } }')
    ).rejects.toThrow()

    // blog.Author name min:2 → BAD_USER_INPUT (validation maps through useDatabase)
    await expect(
      gql('mutation{ createAuthor(name: ""){ id } }')
    ).rejects.toThrow(/BAD_USER_INPUT/)
  })
})
