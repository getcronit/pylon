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

async function gql(
  query: string,
  variables?: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify({query, variables})
  })
  const json = (await res.json()) as {data?: any; errors?: any}
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data
}

/** Simulate an authenticated request (test-only header → principal). */
const asUser = (id: number) => ({'x-user-id': String(id)})
const asAdmin = () => ({'x-user-id': '99', 'x-role': 'ADMIN'})

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
    for (const t of ['notes_note', 'shop_purchase', 'shop_product', 'blog_article', 'blog_activity', 'blog_author']) {
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
    if (build.status !== 0) throw new Error(`build failed: ${String(build.stderr ?? build.stdout ?? "")}`)

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

  it('exposes a computed field (a model method) on the entity', async () => {
    const created = (await gql('mutation($n:String!){ createAuthor(name:$n){ id } }', {n: 'ada'}))
      .createAuthor
    const fetched = (
      await gql('query($id:Number!){ author(id:$id){ name displayName } }', {id: Number(created.id)})
    ).author
    expect(fetched.name).toBe('ada')
    expect(fetched.displayName).toBe('ADA') // method ran on the hydrated instance
  })

  it('a model signal writes an audit row (postSave Author → Activity)', async () => {
    await gql('mutation($n:String!){ createAuthor(name:$n){ id } }', {n: 'Signaled'})
    const acts = (await gql('{ activities { action target } }')).activities
    expect(acts).toContainEqual({action: 'create', target: 'Signaled'})
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

  it('resolves a 3-level nested query in O(depth) round-trips, not O(rows) (no N+1)', async () => {
    // Seed a distinctly-named set so we can assert on our rows while `authors`
    // still returns everything other tests created.
    const AUTHORS = 4
    const ARTICLES = 3
    const tag = 'n1' // unique name prefix for this test's authors
    const mine: Record<string, string[]> = {}
    for (let a = 0; a < AUTHORS; a++) {
      const name = `${tag}-author-${a}`
      const author = (await gql('mutation($n:String!){ createAuthor(name:$n){ id } }', {n: name}))
        .createAuthor
      mine[name] = []
      for (let t = 0; t < ARTICLES; t++) {
        const title = `${name}-art-${t}`
        await gql('mutation($id:Number!,$t:String!){ addArticle(authorId:$id, title:$t){ id } }', {
          id: Number(author.id),
          t: title
        })
        mine[name].push(title)
      }
    }

    // Measure ONLY the nested read: reset the server-side counter, run the query,
    // then read the counter back (each is its own request; nothing else queries
    // the DB in between).
    await gql('mutation{ _dbQueryReset }')
    const data = await gql(
      '{ authors { name displayName articles { title author { name } } } }'
    )
    const queries = (await gql('{ _dbQueryCount }'))._dbQueryCount as number

    // Data is correct: each of our authors carries exactly its articles, and each
    // article's belongsTo back-ref points to its own author.
    const authors: Array<{
      name: string
      displayName: string
      articles: Array<{title: string; author: {name: string}}>
    }> = data.authors
    for (const [name, titles] of Object.entries(mine)) {
      const row = authors.find(x => x.name === name)
      expect(row, `author ${name} present`).toBeTruthy()
      expect(row!.displayName).toBe(name.toUpperCase()) // computed method ran
      expect(row!.articles.map(ar => ar.title).sort()).toEqual([...titles].sort())
      for (const ar of row!.articles) {
        expect(ar.author.name).toBe(name) // batched belongsTo resolves to the right parent
      }
    }

    // The whole nest is 3 levels: authors → articles (hasMany) → author (belongsTo).
    // Batched, that is ~3 round-trips total regardless of row count. A naive N+1
    // implementation would issue 1 + (#authors) + (#articles) queries, far larger
    // and growing with the seed. Allow a little slack but stay well below linear.
    const naive = 1 + authors.length + authors.reduce((n, x) => n + x.articles.length, 0)
    expect(queries).toBeGreaterThan(0)
    expect(queries).toBeLessThanOrEqual(4)
    expect(queries).toBeLessThan(naive)
  })

  // ── Row-level authorization (definePolicy) through the real request path ────
  describe('row-level policy (notes app) — principal bound from headers', () => {
    it('seeds notes as two users; CREATE stamps owner from the principal', async () => {
      const c1 = (
        await gql('mutation($t:String!){ createNote(title:$t, shared:false){ ownerId } }', {t: 'a1'}, asUser(1))
      ).createNote
      expect(c1.ownerId).toBe(1) // stamped from the principal
      await gql('mutation($t:String!){ createNote(title:$t, shared:true){ id } }', {t: 'a2'}, asUser(1))
      await gql('mutation($t:String!){ createNote(title:$t, shared:false){ id } }', {t: 'b1'}, asUser(2))
    })

    it('READ is scoped to the requesting principal (own + shared; admin all)', async () => {
      const u1 = (await gql('{ notes { title } }', {}, asUser(1))).notes.map((n: any) => n.title)
      expect(u1).toEqual(['a1', 'a2'])
      const u2 = (await gql('{ notes { title } }', {}, asUser(2))).notes.map((n: any) => n.title)
      expect(u2).toEqual(['a2', 'b1']) // shared a2 + own b1
      const admin = (await gql('{ notes { title } }', {}, asAdmin())).notes.map((n: any) => n.title)
      expect(admin).toEqual(['a1', 'a2', 'b1'])
    })

    it('CREATE without a principal is FORBIDDEN', async () => {
      await expect(
        gql('mutation{ createNote(title:"x", shared:false){ id } }')
      ).rejects.toThrow(/FORBIDDEN/)
    })

    it('UPDATE a readable-but-unowned row → FORBIDDEN; owner may update', async () => {
      // user 2 can READ a2 (shared) but not UPDATE it (owned by user 1).
      const a2 = (await gql('{ notes { id title } }', {}, asUser(2))).notes.find(
        (n: any) => n.title === 'a2'
      )
      await expect(
        gql(
          'mutation($id:Number!){ renameNote(id:$id, title:"hax"){ id } }',
          {id: Number(a2.id)},
          asUser(2)
        )
      ).rejects.toThrow(/FORBIDDEN/)
      const ok = await gql(
        'mutation($id:Number!){ renameNote(id:$id, title:"a2!"){ title } }',
        {id: Number(a2.id)},
        asUser(1)
      )
      expect(ok.renameNote.title).toBe('a2!')
    })

    it('.unscoped() bypasses policy for a system path', async () => {
      const all = (await gql('{ notesAsSystem { title } }', {}, asUser(1))).notesAsSystem
      expect(all.length).toBeGreaterThanOrEqual(3) // sees others' rows despite being user 1
    })
  })
})
