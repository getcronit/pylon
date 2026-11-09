/**
 * A SHARDED sitemap (index + shards), against a running app.
 *
 * Two claims:
 *  1. The sitemap INDEX advertises shard URLs on the configured `origin`, not the
 *     request `Host` — the same guard the shard/main renderers already apply. A
 *     regression here would leak `localhost` (or a spoofed proxy host) into the index.
 *  2. A shard fetches its URLs from the app's own GraphQL via server-side `op`,
 *     receiving its `{id}` — the sharded counterpart of sitemap-data-app.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/sitemap-index-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4800
const base = `http://localhost:${PORT}`
let server: ChildProcess | undefined
let serverLog = ''

const get = (p: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${p}`, {headers, redirect: 'manual'})

const locs = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1])

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

describe('sharded sitemap index + op-backed shard', () => {
  it('index advertises shard URLs on the configured origin, never the request host', async () => {
    const res = await get('/sitemap.xml')
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<sitemapindex')
    const shardUrls = locs(xml)
    expect(shardUrls).toContain('https://shop.example/sitemap/products.xml')
    expect(shardUrls).toContain('https://shop.example/sitemap/static.xml')
    // The bug this guards: a request-host origin would emit http://localhost:PORT/…
    expect(xml).not.toContain('localhost')
    for (const u of shardUrls) expect(u).toMatch(/^https:\/\/shop\.example/)
  })

  it('renders the op-backed products shard with absolute product URLs', async () => {
    const xml = await (await get('/sitemap/products.xml')).text()
    const l = locs(xml)
    expect(l).toContain('https://shop.example/products/alpha')
    expect(l).toContain('https://shop.example/products/gamma')
    expect(xml).toContain('<lastmod>2026-01-01</lastmod>')
    expect(xml).not.toContain('localhost')
  })

  it('renders the static shard', async () => {
    const l = locs(await (await get('/sitemap/static.xml')).text())
    expect(l).toContain('https://shop.example/')
    expect(l).toContain('https://shop.example/pricing')
  })
})
