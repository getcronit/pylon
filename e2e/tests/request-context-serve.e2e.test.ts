/**
 * `useRequestContext()` — the request-scoped read channel into a usePages SSR render.
 *
 * The plugin puts a value on the Hono context as `pagesContext`; the SSR catch-all reads it
 * before rendering and serialises it into `window.__pylonStaticData.context`, so the browser
 * hydrates with the IDENTICAL value. That is what makes cookie-driven theme / sidebar /
 * locale flash-free: the state is in the first byte of HTML rather than applied after mount.
 *
 * What this pins down, per rfcs/SSR_REQUEST_CONTEXT.md P0:
 *   - cookies read at SSR actually change the rendered markup,
 *   - the SAME object reaches the client (no hydration mismatch by construction),
 *   - `useRequestContext` is ordered before the usePages catch-all WITHOUT the app
 *     arranging it — the ordering bug this helper exists to prevent,
 *   - `Vary` is emitted, additively and without duplicates.
 *
 * Serving, not just building: an SSR read channel that compiles but renders the default on
 * every request would pass a build-only test.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/request-context-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4788
const base = `http://localhost:${PORT}`
let server: ChildProcess | undefined
let serverLog = ''

/** GET `/` with an optional Cookie header. */
const get = (cookie?: string) =>
  fetch(base, {headers: cookie ? {Cookie: cookie} : {}})

const textOf = async (cookie?: string) => (await get(cookie)).text()

/** Pull `id="x">value` out of the SSR markup. */
const byId = (html: string, id: string): string | undefined =>
  html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1]

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
      await get()
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

describe('useRequestContext at SSR', () => {
  it('renders the default context when no cookies are sent', async () => {
    const html = await textOf()
    expect(byId(html, 'theme')).toBe('system')
    expect(byId(html, 'locale')).toBe('en')
    expect(html).toContain('data-state="open"')
    expect(html).toContain('<html lang="en"')
  })

  it('renders cookie-driven state into the FIRST byte of HTML, not after mount', async () => {
    const html = await textOf('theme=dark; locale=de; sidebar=closed')
    expect(byId(html, 'theme')).toBe('dark')
    expect(byId(html, 'locale')).toBe('de')
    expect(html).toContain('data-state="closed"')
    // The layout reads the same context — this is the flash-free `<html>` attribute case.
    expect(html).toContain('<html lang="de"')
    expect(html).toContain('class="dark"')
  })

  it('varies per request rather than caching the first render', async () => {
    // Two different cookies back to back: a context captured at boot would return the same
    // markup twice.
    const [de, fr] = await Promise.all([textOf('locale=de'), textOf('locale=fr')])
    expect(byId(de, 'locale')).toBe('de')
    expect(byId(fr, 'locale')).toBe('fr')
  })

  it('hands the client the identical context (hydration parity by construction)', async () => {
    const html = await textOf('theme=dark; locale=de; sidebar=closed')
    const payload = html.match(/window\.__pylonStaticData = (\{.*?\});/)?.[1]
    expect(payload, `no hydration envelope in:\n${html.slice(0, 400)}`).toBeDefined()

    const {context} = JSON.parse(payload!)
    // Exactly what the server rendered from — so the client cannot disagree.
    expect(context).toEqual({theme: 'dark', sidebarOpen: false, locale: 'de'})
  })

  it('beats the usePages catch-all even when listed after it in `plugins`', async () => {
    // The fixture deliberately lists `useRequestContext` AFTER `usePages`. Middleware runs in
    // registration order, so array position alone would register it after the catch-all and
    // SSR would read an empty context — rendering the defaults despite the cookie. It works
    // because the helper is 'first'-strategy and usePages is 'last': the phase wins.
    // Flipping the helper to 'last' makes this fail, which is the point of asserting it.
    const html = await textOf('theme=dark')
    expect(byId(html, 'theme')).toBe('dark')
    expect(byId(html, 'theme')).not.toBe('system')
  })
})

describe('Vary', () => {
  it('emits the declared Vary header on the SSR response', async () => {
    const res = await get('theme=dark')
    expect(res.headers.get('Vary')?.toLowerCase()).toContain('cookie')
  })

  it('does not duplicate an entry across requests', async () => {
    const vary = (await get()).headers.get('Vary') ?? ''
    const cookieEntries = vary
      .split(',')
      .map(v => v.trim().toLowerCase())
      .filter(v => v === 'cookie')
    expect(cookieEntries).toHaveLength(1)
  })
})
