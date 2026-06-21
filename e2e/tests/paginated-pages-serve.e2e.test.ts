/**
 * Serve-time e2e for usePaginatedData (Relay connection pages).
 *
 * A `usePaginatedData()` page over a `posts(first, after)` connection. Asserts:
 *   - the analyzer compiles a valid connection document (build succeeds + serves),
 *   - SSR renders the FIRST window (default page size 20) from the connection,
 *   - the connection pages correctly server-side (POST first/after returns the
 *     next slice) — the data `loadNext` fetches and merges on the client.
 *
 * The client-side window MERGE (loadNext appending) is covered by the interactive
 * browser validation; this locks the server + SSR + document-compilation half.
 *
 * No DB / docker needed (in-memory posts).
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(dir, '..')
const cliBin = path.resolve(e2eRoot, '../packages/pylon-dev/dist/index.js')
const appDir = path.resolve(e2eRoot, 'fixtures/paginated-pages-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4782
const base = `http://localhost:${PORT}`

let server: ChildProcess | undefined
const log: string[] = []

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({query, variables})
  })
  return (await res.json()) as {data?: any; errors?: {message: string}[]}
}

async function waitForReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`server did not become ready\n${log.slice(-30).join('')}`)
}

describe('usePaginatedData serve', () => {
  let html = ''

  beforeAll(async () => {
    if (!existsSync(cliBin)) {
      throw new Error(`pylon CLI not built at ${cliBin}.`)
    }
    await fs.rm(pylonDir, {recursive: true, force: true})

    const build = spawnSync('node', [cliBin, 'build'], {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    if (build.status !== 0) {
      throw new Error(`build failed: ${String(build.stderr ?? build.stdout ?? '')}`)
    }

    server = spawn('node', ['.pylon/index.js'], {
      cwd: appDir,
      env: {...process.env, PORT: String(PORT), PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
    })
    server.stdout?.on('data', d => log.push(String(d)))
    server.stderr?.on('data', d => log.push(String(d)))

    await waitForReady()
    html = await (await fetch(`${base}/`)).text()
  }, 180_000)

  afterAll(async () => {
    server?.kill('SIGKILL')
    await fs.rm(pylonDir, {recursive: true, force: true})
  })

  it('SSR-renders the first window (page size 20) of the connection', () => {
    expect(html).toContain('Post 1<')
    expect(html).toContain('Post 20<')
    // window 0 only — the 21st item is not on the initial page
    expect(html).not.toContain('Post 21<')
    // count = nodes.length (20), total = totalCount (25), hasNext = true
    expect(html).toMatch(/id="count">(<!-- -->)*20</)
    expect(html).toMatch(/id="total">(<!-- -->)*25</)
    expect(html).toMatch(/id="hasNext">(<!-- -->)*true</)
  })

  it('the connection pages forward server-side (first/after returns the next slice)', async () => {
    const r = await gql(
      `query($first: Number!, $after: String) {
        posts(first: $first, after: $after) {
          totalCount
          pageInfo { hasNextPage endCursor }
          edges { cursor node { id title } }
        }
      }`,
      {first: 5, after: '20'}
    )
    expect(r.errors).toBeUndefined()
    const conn = r.data.posts
    expect(conn.totalCount).toBe(25)
    expect(conn.edges.map((e: any) => e.node.title)).toEqual([
      'Post 21',
      'Post 22',
      'Post 23',
      'Post 24',
      'Post 25'
    ])
    expect(conn.pageInfo.hasNextPage).toBe(false)
    expect(conn.pageInfo.endCursor).toBe('25')
  })
})
