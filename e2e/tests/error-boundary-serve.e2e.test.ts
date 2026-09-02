/**
 * Per-segment error containment for a running usePages app.
 *
 * The failure this guards against: one `useData` read whose upstream is down takes the
 * WHOLE document down — every route sharing the failing layout renders a chrome-less
 * 500 — because the throw has no nearby boundary and escalates to the root.
 *
 * The fix (see setup/index.tsx + app-utils.ts): `useData` tags each read with its
 * owning route id; a failed SSR render is attributed to the SHALLOWEST failing route,
 * and React Router renders THAT route's `errorElement` in place of it — server-side,
 * with ancestor chrome intact. A sibling `error.tsx` overrides the boundary UI. The
 * inline `<ErrorBoundary>` contains a widget failure without failing its page.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/error-boundary-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4801
const base = `http://localhost:${PORT}`
let server: ChildProcess | undefined
let serverLog = ''
let buildOutput = ''

const get = (p: string) => fetch(`${base}${p}`, {redirect: 'manual'})
const body = async (p: string) => {
  const res = await get(p)
  return {status: res.status, html: await res.text()}
}

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
  buildOutput = `${build.stdout ?? ''}\n${build.stderr ?? ''}`
  if (build.status !== 0) {
    throw new Error(`build failed:\n${buildOutput}`)
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

describe('per-segment error containment', () => {
  it('serves a healthy route normally (data resolves)', async () => {
    const {status, html} = await body('/')
    expect(status).toBe(200)
    expect(html).toContain('id="root-chrome"')
    // React splits interpolated text with a comment marker: `home:<!-- -->ok`.
    expect(html).toMatch(/home:(<!-- -->)?ok/)
  })

  it('contains a failing LAYOUT to its segment, root chrome intact, 500', async () => {
    const {status, html} = await body('/dashboard')
    expect(status).toBe(500)
    // The whole document did NOT go down: the root layout still rendered.
    expect(html).toContain('id="root-chrome"')
    // The segment boundary rendered — and it's the custom error.tsx, SERVER-SIDE.
    expect(html).toContain('id="dash-error"')
    expect(html).toContain('id="dash-error-message"')
  })

  it('uses the default error page when a segment has no error.tsx', async () => {
    const {status, html} = await body('/plain')
    expect(status).toBe(500)
    expect(html).toContain('id="root-chrome"')
    // No custom boundary here — the built-in GlobalErrorPage, inside the chrome.
    expect(html).not.toContain('id="dash-error"')
    expect(html.toLowerCase()).toContain('error')
  })

  it('attributes a LEAF-page failure to the leaf, not a hardcoded layout', async () => {
    const {status, html} = await body('/leaf')
    expect(status).toBe(500)
    expect(html).toContain('id="root-chrome"')
  })

  it('never falls through to the critical whole-app error page', () => {
    expect(serverLog).not.toContain('CRITICAL RENDER ERROR')
  })

  it('warns at build when no root pages/error.tsx exists', () => {
    // This fixture deliberately has no root error.tsx (so /plain and /leaf exercise the
    // default error page) — the build must say so rather than fail silently.
    expect(buildOutput).toMatch(/No root .*pages\/error\.tsx/)
  })

  describe('custom not-found.tsx', () => {
    it('renders the root not-found.tsx for an unmatched path, with 404', async () => {
      const {status, html} = await body('/does-not-exist')
      expect(status).toBe(404)
      expect(html).toContain('id="root-not-found"')
    })

    it('cascades: a nested segment 404 uses the inherited not-found inside its chrome', async () => {
      const {status, html} = await body('/section/does-not-exist')
      expect(status).toBe(404)
      expect(html).toContain('id="section-chrome"')
      expect(html).toContain('id="root-not-found"')
    })
  })

  describe('error.tsx cascades to nested segments (Next.js semantics)', () => {
    it('renders a healthy parent segment normally', async () => {
      const {status, html} = await body('/section')
      expect(status).toBe(200)
      expect(html).toContain('id="section-chrome"')
      expect(html).toContain('id="section-page"')
    })

    it('a nested route with no error.tsx inherits the ancestor error.tsx', async () => {
      const {status, html} = await body('/section/deep')
      expect(status).toBe(500)
      // Ancestor chrome (root + section layout) survives.
      expect(html).toContain('id="root-chrome"')
      expect(html).toContain('id="section-chrome"')
      // The INHERITED /section/error.tsx renders here — not the default error page.
      expect(html).toContain('id="section-error"')
    })
  })

  describe('<ErrorBoundary>', () => {
    it('renders a healthy wrapped read INLINE server-side (no Suspense, no fallback)', async () => {
      const {status, html} = await body('/widget-ok')
      expect(status).toBe(200)
      expect(html).toMatch(/okwidget:(<!-- -->)?ok/)
      // Inline = no deferred Suspense boundary in the output. A fallback-then-swap
      // would leave `<!--$?-->` and hide the content in a template.
      expect(html).not.toContain('<!--$?-->')
      expect(html).not.toContain('<template')
    })

    it('with a manually-composed <Suspense>, keeps the page up (200) when a wrapped widget fails', async () => {
      const {status, html} = await body('/widget')
      expect(status).toBe(200)
      // Page content and sibling render server-side despite the widget failing.
      expect(html).toContain('id="widget-page"')
      expect(html).toContain('id="widget-sibling"')
      // The manually-added Suspense streams its fallback; React 19 renders the
      // error UI on the client.
      expect(html).toContain('id="widget-pending"')
    })
  })
})
