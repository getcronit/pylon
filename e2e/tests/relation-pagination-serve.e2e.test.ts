/**
 * Serve-time e2e for PAGINATED RELATIONS: a `hasMany` and a `manyToMany` declared
 * `{paginate: true}` surface as Relay `Connection` fields (first/after/last/before
 * args) and page correctly at runtime — while a plain relation stays a list.
 *   - author.posts(first, after) → forward cursor pages over a hasMany,
 *   - post.tags(first, after)    → forward cursor pages THROUGH the m2m join,
 *   - the Proxy accessor still allows manager writes on a paginated relation
 *     (the `tagPost` mutation does `post.tags.add(...)`).
 * Dockerized Postgres; skipped if absent.
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
const appDir = path.resolve(e2eRoot, 'fixtures/relation-pagination-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4774
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
  return (await res.json()) as {data?: any; errors?: {message: string}[]}
}

async function resetSchema() {
  const db: Database = connect({connectionString})
  try {
    for (const t of ['post_tag', 'post', 'tag', 'author', '_pylon_migrations']) {
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

let authorId: number
const tagIds: number[] = []

describe.skipIf(!dockerAvailable)('paginated relations (hasMany + manyToMany)', () => {
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

    // One author with 5 posts; post #1 linked to 3 tags.
    const a = await gql('mutation($n:String!){addAuthor(name:$n){id}}', {n: 'Ada'})
    if (a.errors) throw new Error(JSON.stringify(a.errors))
    authorId = Number(a.data.addAuthor.id)
    const postIds: number[] = []
    for (let i = 1; i <= 5; i++) {
      const r = await gql('mutation($a:Number!,$t:String!){addPost(authorId:$a,title:$t){id}}', {
        a: authorId,
        t: `Post ${i}`
      })
      if (r.errors) throw new Error(JSON.stringify(r.errors))
      postIds.push(Number(r.data.addPost.id))
    }
    for (const label of ['x', 'y', 'z']) {
      const r = await gql('mutation($l:String!){addTag(label:$l){id}}', {l: label})
      if (r.errors) throw new Error(JSON.stringify(r.errors))
      tagIds.push(Number(r.data.addTag.id))
    }
    for (const tid of tagIds) {
      const r = await gql('mutation($p:Number!,$t:Number!){tagPost(postId:$p,tagId:$t)}', {
        p: postIds[0],
        t: tid
      })
      if (r.errors) throw new Error(`tagPost (proxy .add on paginated relation): ${JSON.stringify(r.errors)}`)
    }
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true}).catch(() => {})
  })

  it('hasMany: author.posts pages forward with a cursor (first/after)', async () => {
    const page1 = await gql(
      `query($id:Number!){author(id:$id){posts(first:2){edges{cursor node{title}} pageInfo{hasNextPage endCursor} totalCount}}}`,
      {id: authorId}
    )
    expect(page1.errors).toBeUndefined()
    const p1 = page1.data.author.posts
    expect(p1.totalCount).toBe(5)
    expect(p1.edges.map((e: any) => e.node.title)).toEqual(['Post 1', 'Post 2'])
    expect(p1.pageInfo.hasNextPage).toBe(true)

    const page2 = await gql(
      `query($id:Number!,$c:String!){author(id:$id){posts(first:2,after:$c){nodes{title} pageInfo{hasNextPage}}}}`,
      {id: authorId, c: p1.pageInfo.endCursor}
    )
    expect(page2.errors).toBeUndefined()
    expect(page2.data.author.posts.nodes.map((n: any) => n.title)).toEqual(['Post 3', 'Post 4'])
    expect(page2.data.author.posts.pageInfo.hasNextPage).toBe(true)
  })

  it('manyToMany: post.tags pages forward THROUGH the join', async () => {
    // Reach the tagged post via the author's posts connection, then page its tags.
    const r = await gql(
      `query($id:Number!){author(id:$id){posts(first:1){nodes{tags(first:2){nodes{label} pageInfo{hasNextPage endCursor} totalCount}}}}}`,
      {id: authorId}
    )
    expect(r.errors).toBeUndefined()
    const tags = r.data.author.posts.nodes[0].tags
    expect(tags.totalCount).toBe(3)
    expect(tags.nodes.map((t: any) => t.label)).toEqual(['x', 'y'])
    expect(tags.pageInfo.hasNextPage).toBe(true)

    const r2 = await gql(
      `query($id:Number!,$c:String!){author(id:$id){posts(first:1){nodes{tags(first:2,after:$c){nodes{label} pageInfo{hasNextPage}}}}}}`,
      {id: authorId, c: tags.pageInfo.endCursor}
    )
    expect(r2.errors).toBeUndefined()
    const tags2 = r2.data.author.posts.nodes[0].tags
    expect(tags2.nodes.map((t: any) => t.label)).toEqual(['z'])
    expect(tags2.pageInfo.hasNextPage).toBe(false)
  })
})
