/**
 * Prefix locale routing — P2 of rfcs/SSR_I18N.md, against a running app.
 *
 * The claim under test: ONE `pages/` tree serves every locale. There is no `[locale]`
 * folder, because prefix routing is React Router's `basename` rather than a duplicated route
 * table — `createStaticHandler(routes, {basename})` per locale on the server, and the same
 * basename on the client, taken from the hydration envelope so the two cannot disagree.
 *
 * The basename has to reach `matchRoutes` as well as the router. It is the call that
 * pre-resolves lazy route modules before hydration; without the basename `/de/pricing`
 * strips to nothing, matches no route, the modules stay unresolved, and the client renders
 * HydrateFallback over the server's real markup. That surfaced as a bare "Hydration failed"
 * with a <div> (the fallback) where a <script> was expected — an hour of bisecting, and
 * invisible to any assertion that only reads server HTML. Hence the marker assertions here.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/i18n-prefix-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4793
const base = `http://localhost:${PORT}`
let server: ChildProcess | undefined
let serverLog = ''

const get = (p: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${p}`, {headers, redirect: 'manual'})

const byId = (html: string, id: string): string | undefined =>
  html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1]

const page = async (p: string, headers?: Record<string, string>) => {
  const html = await (await get(p, headers)).text()
  return {
    html,
    page: byId(html, 'page'),
    locale: byId(html, 'locale'),
    copy: byId(html, 'copy'),
    basename: byId(html, 'basename'),
    suggested: byId(html, 'suggested')
  }
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

describe('one pages/ tree, every locale', () => {
  it('serves the default locale unprefixed', async () => {
    const r = await page('/')
    expect(r.page).toBe('home')
    expect(r.locale).toBe('en')
    expect(r.copy).toBe('Home')
    expect(r.basename).toBe('(root)')
    expect(r.html).toContain('<html lang="en"')
  })

  it('serves a prefixed locale from the SAME route file', async () => {
    const r = await page('/de')
    expect(r.page).toBe('home')       // pages/page.tsx, matched under basename /de
    expect(r.locale).toBe('de')
    expect(r.copy).toBe('Startseite')
    expect(r.basename).toBe('/de')
    expect(r.html).toContain('<html lang="de"')
  })

  it('matches nested routes under the prefix', async () => {
    const en = await page('/pricing')
    const de = await page('/de/pricing')
    const fr = await page('/fr/pricing')
    expect([en.page, de.page, fr.page]).toEqual(['pricing', 'pricing', 'pricing'])
    expect([en.copy, de.copy, fr.copy]).toEqual(['Pricing', 'Preise', 'Tarifs'])
  })

  it('404s an unconfigured locale rather than treating it as a page', async () => {
    // `/es` is not in `locales`, so it is a normal (missing) route, not a locale.
    expect((await get('/es/pricing')).status).toBe(404)
  })
})

describe('the URL is authoritative', () => {
  it('ignores a cookie that disagrees, and offers it as a suggestion instead', async () => {
    // Serving German at the English URL would give one URL two contents and make its
    // canonical a lie. The hint becomes a link the visitor can take.
    const r = await page('/pricing', {Cookie: 'locale=de'})
    expect(r.locale).toBe('en')
    expect(r.copy).toBe('Pricing')
  })

  it('ignores Accept-Language that disagrees', async () => {
    const r = await page('/pricing', {'Accept-Language': 'de-DE,de;q=0.9'})
    expect(r.locale).toBe('en')
  })

  it('surfaces the disagreement as suggestedLocale', async () => {
    const r = await page('/', {Cookie: 'locale=fr'})
    expect(r.locale).toBe('en')
    expect(r.suggested).toBe('fr')
  })

  it('offers no suggestion when the hint agrees', async () => {
    const r = await page('/de', {Cookie: 'locale=de'})
    expect(r.suggested).toBe('(none)')
  })
})

describe('canonical redirects — deterministic, never negotiated', () => {
  it('301s the default locale prefix away under as-needed', async () => {
    const res = await get('/en/pricing')
    expect(res.status).toBe(301)
    expect(new URL(res.headers.get('Location')!, base).pathname).toBe('/pricing')
  })

  it('301s /en to /', async () => {
    const res = await get('/en')
    expect(res.status).toBe(301)
    expect(new URL(res.headers.get('Location')!, base).pathname).toBe('/')
  })

  it('preserves the query string across the redirect', async () => {
    const res = await get('/en/pricing?plan=pro')
    expect(res.headers.get('Location')).toContain('plan=pro')
  })

  it('redirects identically regardless of cookie or Accept-Language', async () => {
    // The whole point: a crawler sending neither signal, and a visitor sending both, must
    // be sent to the SAME place. A varying redirect is what funnels every crawler to one
    // locale.
    const plain = await get('/en/pricing')
    const hinted = await get('/en/pricing', {
      Cookie: 'locale=de',
      'Accept-Language': 'fr-FR,fr;q=0.9'
    })
    expect(hinted.status).toBe(plain.status)
    expect(hinted.headers.get('Location')).toBe(plain.headers.get('Location'))
  })

  it('never redirects an already-canonical URL', async () => {
    for (const p of ['/', '/pricing', '/de', '/de/pricing']) {
      expect((await get(p)).status, p).toBe(200)
    }
  })
})

describe('links and hydration data carry the locale', () => {
  it('a plain <Link> resolves within the active locale', async () => {
    // basename does this; the app writes href="/pricing" and gets the prefixed URL.
    expect((await page('/de')).html).toContain('href="/de/pricing"')
    expect((await page('/')).html).toContain('href="/pricing"')
  })

  it('ships the basename in the hydration envelope', async () => {
    // The client reads THIS rather than re-deriving it from config, so server and client
    // cannot disagree about where the routes are mounted.
    const html = (await page('/de')).html
    const data = JSON.parse(html.match(/window\.__pylonStaticData = (\{.*?\});/)![1])
    expect(data.i18n.basename).toBe('/de')
    expect(data.i18n.locale).toBe('de')

    const root = JSON.parse(
      (await page('/')).html.match(/window\.__pylonStaticData = (\{.*?\});/)![1]
    )
    expect(root.i18n.basename).toBe('')
  })

  it('does not server-render the hydrate fallback', async () => {
    // The fallback is <div>Loading...</div>. Seeing it in SSR output means the route
    // modules were not resolved — the same failure the client hits when matchRoutes is
    // called without the basename.
    for (const p of ['/', '/de', '/de/pricing']) {
      expect((await page(p)).html, p).not.toContain('Loading...')
    }
  })
})

describe('<Link locale> — the language switcher', () => {
  // A plain <Link> is confined to the active locale by basename, which is right for
  // navigation and useless for switching language. `locale` crosses that boundary.
  const anchors = (html: string) =>
    Object.fromEntries(
      [...html.matchAll(/<a ([^>]*)>/g)]
        .map(m => m[1])
        .map(attrs => [
          attrs.match(/id="([^"]*)"/)?.[1],
          attrs.match(/href="([^"]*)"/)?.[1]
        ])
        .filter(([id]) => id)
    ) as Record<string, string>

  it('points at the current page in another locale', async () => {
    const fromEn = anchors((await page('/')).html)
    expect(fromEn['switch-de']).toBe('/de')

    const fromDe = anchors((await page('/de')).html)
    // Back to the DEFAULT locale, which is unprefixed under as-needed.
    expect(fromDe['switch-en']).toBe('/')
  })

  it('can target a specific page in another locale', async () => {
    for (const from of ['/', '/de']) {
      expect(anchors((await page(from)).html)['switch-fr-pricing']).toBe('/fr/pricing')
    }
  })

  it('leaves a same-locale link to normal routing', async () => {
    // `locale` equal to the active one is not a switch; it stays a router Link, so
    // client-side navigation still works.
    expect(anchors((await page('/de')).html)['switch-de']).toBe('/de')
    expect(anchors((await page('/')).html)['switch-en']).toBe('/')
  })

  it('annotates the cross-locale anchor with hreflang', async () => {
    const html = (await page('/')).html
    expect(html).toMatch(/<a href="\/de" hreflang="de"/i)
  })

  it('renders a plain anchor, not a router link, when crossing locales', async () => {
    // Deliberate: a client-side transition would keep <html lang>, the SSR copy and the
    // hydration envelope from the OLD locale. The other language is a different document.
    const html = (await page('/')).html
    const switchTag = html.match(/<a [^>]*id="switch-de"[^>]*>/)![0]
    expect(switchTag).not.toContain('data-discover')
  })

  it('does not leak react-router props onto the anchor', async () => {
    const html = (await page('/')).html
    const switchTag = html.match(/<a [^>]*id="switch-de"[^>]*>/)![0]
    for (const prop of ['replace', 'preventScrollReset', 'relative', 'viewTransition']) {
      expect(switchTag, prop).not.toContain(prop)
    }
  })
})
