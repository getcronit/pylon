/**
 * `loading.tsx` — framework-managed Suspense boundaries per route segment, and progressive
 * streaming (rfcs/PAGES_STREAMING.md).
 *
 * The SSR handler always uses the streaming send path in prod: React flushes the shell as soon
 * as it is ready, so a `loading.tsx` boundary whose `useData` is still pending emits its FALLBACK
 * in the shell and streams the resolved segment in behind it. With NO boundary in the chain the
 * shell is the whole document, so it degenerates to the buffered result — no fallback, no
 * behavioral difference.
 *
 * What this pins down:
 *   - a segment WITH its own `loading.tsx` streams: the fallback is in the shell AND the resolved
 *     content arrives, on the same response;
 *   - a nested segment that INHERITS the fallback does the same (cascade);
 *   - a route with no `loading.tsx` in its chain shows no fallback (degenerates to buffered);
 *   - the generated routes wire `withLoading(...)` + `HydrateFallback` for own AND inherited
 *     segments, and do NOT wire it where no `loading.tsx` exists;
 *   - the fallback component is shipped to the client bundle (also the client nav loading state).
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/loading-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4813
const base = `http://localhost:${PORT}`
let server: ChildProcess | undefined
let serverLog = ''
let buildOutput = ''

const LOADING_MARKER = 'SECTION-LOADING-FALLBACK'

const get = (p: string) => fetch(`${base}${p}`, {redirect: 'manual'})
// React separates adjacent text nodes (`{"x:"}{value}`) with an empty comment during SSR,
// so `x:<!-- -->value` is the on-the-wire form. Strip those to assert on the logical text.
const strip = (html: string) => html.replace(/<!--\s*-->/g, '')
const body = async (p: string) => {
  const res = await get(p)
  return {status: res.status, html: strip(await res.text())}
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

describe('streaming: a loading.tsx boundary flushes its fallback in the shell and streams the segment', () => {
  it('streams a segment WITH its own loading.tsx — fallback in the shell AND resolved content', async () => {
    const {status, html} = await body('/section')
    expect(status).toBe(200)
    // Ancestor chrome renders immediately.
    expect(html).toContain('section-chrome')
    // The boundary's fallback is in the shell (the segment's data was still pending)…
    expect(html).toContain(LOADING_MARKER)
    // …and the resolved content is streamed in on the SAME response.
    expect(html).toContain('section-page:slow-ok')
    // The post-render hydration payload is appended too.
    expect(html).toContain('Object.assign(window.__pylonStaticData')
  })

  it('streams a nested segment that INHERITS the fallback (cascade)', async () => {
    const {status, html} = await body('/section/deep')
    expect(status).toBe(200)
    expect(html).toContain(LOADING_MARKER)
    expect(html).toContain('deep-page:slow-ok')
  })
})

describe('no boundary in the chain → no fallback (degenerates to buffered)', () => {
  it('renders the home route with no fallback', async () => {
    const {status, html} = await body('/')
    expect(status).toBe(200)
    expect(html).toContain('home:ok')
    expect(html).not.toContain(LOADING_MARKER)
  })

  it('renders a sibling of /section with no loading.tsx and no fallback', async () => {
    const {status, html} = await body('/plain')
    expect(status).toBe(200)
    expect(html).toContain('plain-page:ok')
    expect(html).not.toContain(LOADING_MARKER)
  })
})

describe('the generated routes wire the boundary (own + inherited), and only where a loading.tsx exists', () => {
  let app = ''
  beforeAll(async () => {
    app = await fs.readFile(path.join(pylonDir, 'app.tsx'), 'utf8')
  })

  it('defines the withLoading helper and imports the fallback', () => {
    expect(app).toContain('function withLoading(')
    expect(app).toContain('SectionLoading')
  })

  it('wraps the OWNING segment page in withLoading + wires HydrateFallback', () => {
    expect(app).toContain(
      'withLoading(withRouteData(i.default, "SectionPage", undefined), SectionLoading)'
    )
    // HydrateFallback for the segment is its loading component, not the built-in default.
    expect(app).toMatch(/"HydrateFallback":\s*SectionLoading/)
  })

  it('CASCADES to the nested segment with no own loading.tsx', () => {
    expect(app).toContain(
      'withLoading(withRouteData(i.default, "SectionDeepPage", undefined), SectionLoading)'
    )
  })

  it('does NOT wrap segments without a loading.tsx in their chain', () => {
    // The root page compiles to the bare name `Page` (no segment prefix); `plain/page.tsx`
    // to `PlainPage`. Neither is under a `loading.tsx`, so neither is wrapped.
    expect(app).toContain('withRouteData(i.default, "Page", undefined)')
    expect(app).not.toContain('withLoading(withRouteData(i.default, "Page"')
    expect(app).toContain('withRouteData(i.default, "PlainPage", undefined)')
    expect(app).not.toContain('withLoading(withRouteData(i.default, "PlainPage"')
  })
})

describe('the fallback is shipped to the client bundle (for client navigation)', () => {
  it('the client bundle contains the loading component', async () => {
    const {html} = await body('/section')
    const src = html.match(/src="(\/__pylon\/static\/app-[^"]+\.js)"/)?.[1]
    expect(src).toBeTruthy()
    const bundle = await (await fetch(`${base}${src}`)).text()
    // The fallback markup must survive bundling (it renders on client navigation).
    expect(bundle).toContain(LOADING_MARKER)
  })
})
