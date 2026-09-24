/**
 * A sitemap that fetches its URLs from the app's OWN GraphQL API, against a running app.
 *
 * The claim under test: `op` works on the SERVER, not just the browser. `pages/sitemap.ts`
 * calls `op.query(q => q.products(…))` to build one URL per product. The pages runtime binds
 * a per-request client (in-process fetcher, forwards the request's headers) in
 * AsyncLocalStorage around the sitemap invocation, and `op` resolves it there — so the module
 * runs the compiled operation against the local schema with no network hop.
 *
 * This is the regression the `resolve` → `op` migration dropped: `op`'s client was gated to
 * `typeof window !== 'undefined'`, so a server-side imperative query threw
 * "no client registered for `op` … imperative ops are browser-only" and /sitemap.xml 500'd.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/sitemap-data-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4799
const base = `http://localhost:${PORT}`
let server: ChildProcess | undefined
let serverLog = ''

const get = (p: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${p}`, {headers, redirect: 'manual'})

beforeAll(async () => {
  if (!existsSync(cliBin)) {
    throw new Error(`pylon CLI not built at ${cliBin}. Run \`pnpm --filter pylon-e2e test\`.`)
  }
  await fs.rm(pylonDir, {recursive: true, force: true})

  const build = spawnSync('node', [cliBin, 'build'], {
    cwd: appDir,
    encoding: 'utf8',
    timeout: 180_000,
    env: {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
  if (build.status !== 0) {
    throw new Error(`build failed:\n${build.stderr ?? ''}\n${build.stdout ?? ''}`)
  }

  server = spawn('node', ['.pylon/server.mjs'], {
    cwd: appDir,
    env: {...process.env, PORT: String(PORT), PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}
  })
  server.stdout?.on('data', d => (serverLog += d))
  server.stderr?.on('data', d => (serverLog += d))

  for (let i = 0; i < 80; i++) {
    try {
      await get('/')
      return
    } catch {
      await new Promise(r => setTimeout(r, 250))
    }
  }
  throw new Error(`server never came up on ${PORT}. Log:\n${serverLog}`)
}, 240_000)

afterAll(async () => {
  server?.kill('SIGKILL')
  await fs.rm(pylonDir, {recursive: true, force: true})
})

describe('sitemap fetches from its own GraphQL via server-side op', () => {
  const sitemap = async () => {
    const res = await get('/sitemap.xml')
    return {res, xml: await res.text()}
  }
  const locs = (xml: string) =>
    [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1])

  it('serves 200, not the 500 that the browser-only op used to throw', async () => {
    const {res, xml} = await sitemap()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('xml')
    // The old failure surfaced as this message in the body/log.
    expect(xml).not.toContain('no client')
    expect(serverLog).not.toContain('Failed to load sitemap module')
  })

  it('emits one absolute URL per product returned by op.query', async () => {
    const l = locs((await sitemap()).xml)
    expect(l).toContain('https://shop.example/products/alpha')
    expect(l).toContain('https://shop.example/products/beta')
    expect(l).toContain('https://shop.example/products/gamma')
    // The static home entry is still there.
    expect(l).toContain('https://shop.example/')
  })

  it('carries per-product data selected through op onto each entry', async () => {
    const {xml} = await sitemap()
    // updatedAt from the resolver → <lastmod> on each product entry.
    expect(xml).toContain('<lastmod>2026-01-01</lastmod>')
    expect(xml).toContain('<lastmod>2026-02-01</lastmod>')
    expect(xml).toContain('<lastmod>2026-03-01</lastmod>')
  })

  it('advertises the configured origin, never the request host', async () => {
    const {xml} = await sitemap()
    expect(xml).not.toContain('localhost')
    for (const loc of locs(xml)) expect(loc).toMatch(/^https:\/\/shop\.example/)
  })

  it('handles concurrent requests without cross-request client bleed', async () => {
    // Each request binds its own per-request client in AsyncLocalStorage; fire a
    // batch at once and every one must still resolve the full product set.
    const results = await Promise.all(Array.from({length: 8}, () => sitemap()))
    for (const {res, xml} of results) {
      expect(res.status).toBe(200)
      expect(locs(xml)).toContain('https://shop.example/products/gamma')
    }
  })
})
