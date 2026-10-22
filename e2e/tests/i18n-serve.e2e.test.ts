/**
 * SSR locale negotiation — P1 of rfcs/SSR_I18N.md, end to end against a running app.
 *
 * The precedence rules themselves are unit-tested in
 * `packages/pylon/test/pages/i18n-negotiate.test.ts`, where every branch is cheap to cover.
 * What only a served app can prove is the part that matters most:
 *
 *   - the negotiated locale is in the FIRST byte of HTML (`<html lang>` and the copy),
 *     not applied after mount the way a client-side i18n library has to,
 *   - the client receives the SERVER's locale in the hydration envelope, so it cannot
 *     derive a different one from `navigator.language`,
 *   - **nothing is ever redirected.** Googlebot and the AI crawlers send no
 *     `Accept-Language`; a framework that redirects on it sends every one of them to the
 *     default locale and leaves the other locales partially discovered. This suite pins the
 *     absence of that behaviour, which is not something a unit test can observe.
 *   - `Vary` names both headers that can change the output.
 *
 * The fixture uses `routing: 'cookie'` because that is what works end to end in this phase;
 * prefix ROUTING (mounting the tree under a locale segment on server and client) lands with
 * a later phase, though its negotiation is already implemented and unit-tested.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/i18n-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4791
const base = `http://localhost:${PORT}`
let server: ChildProcess | undefined
let serverLog = ''

/** `redirect: 'manual'` so a redirect is observable rather than silently followed. */
const req = (headers: Record<string, string> = {}, path = '/') =>
  fetch(`${base}${path}`, {headers, redirect: 'manual'})

const byId = (html: string, id: string): string | undefined =>
  html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1]

const envelope = (html: string): any => {
  const raw = html.match(/window\.__pylonStaticData = (\{.*?\});/)?.[1]
  return raw ? JSON.parse(raw) : undefined
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
      await req()
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

describe('negotiated locale in the server-rendered HTML', () => {
  it('falls back to the default when the request says nothing', async () => {
    const html = await (await req()).text()
    expect(byId(html, 'locale')).toBe('en')
    expect(byId(html, 'greeting')).toBe('Hello')
    expect(byId(html, 'explicit')).toBe('false')
    expect(html).toContain('<html lang="en"')
  })

  it('honours the locale cookie', async () => {
    const html = await (await req({Cookie: 'locale=de'})).text()
    expect(byId(html, 'locale')).toBe('de')
    expect(byId(html, 'greeting')).toBe('Hallo')
    expect(byId(html, 'explicit')).toBe('true')
    expect(html).toContain('<html lang="de"')
  })

  it('falls back to Accept-Language, including region → base language', async () => {
    const html = await (await req({'Accept-Language': 'de-AT,de;q=0.9'})).text()
    expect(byId(html, 'locale')).toBe('de')
    expect(byId(html, 'greeting')).toBe('Hallo')
  })

  it('prefers the cookie over Accept-Language', async () => {
    const html = await (
      await req({Cookie: 'locale=fr', 'Accept-Language': 'de'})
    ).text()
    expect(byId(html, 'locale')).toBe('fr')
    expect(byId(html, 'greeting')).toBe('Bonjour')
  })

  it('ignores an unsupported locale rather than 500ing', async () => {
    const html = await (await req({Cookie: 'locale=xx'})).text()
    expect(byId(html, 'locale')).toBe('en')
  })

  it('negotiates per request rather than freezing the first one', async () => {
    const [de, fr] = await Promise.all([
      req({Cookie: 'locale=de'}).then(r => r.text()),
      req({Cookie: 'locale=fr'}).then(r => r.text())
    ])
    expect(byId(de, 'locale')).toBe('de')
    expect(byId(fr, 'locale')).toBe('fr')
  })
})

describe('never redirects — the crawler guarantee', () => {
  // Googlebot "sends HTTP requests without setting Accept-Language", and Bingbot, GPTBot,
  // ClaudeBot and PerplexityBot generally don't either. A framework that redirects on the
  // header sends all of them to the default locale. These assert the absence of that.
  it('serves 200 to a request with no Accept-Language and no cookie', async () => {
    const res = await req()
    expect(res.status).toBe(200)
    expect(res.headers.get('Location')).toBeNull()
  })

  it('serves 200 — not a redirect — when Accept-Language would pick another locale', async () => {
    const res = await req({'Accept-Language': 'de-DE,de;q=0.9'})
    expect(res.status).toBe(200)
    expect(res.headers.get('Location')).toBeNull()
  })

  it('serves 200 when a cookie would pick another locale', async () => {
    const res = await req({Cookie: 'locale=fr'})
    expect(res.status).toBe(200)
    expect(res.headers.get('Location')).toBeNull()
  })

  it('renders the AI-crawler default header without any redirect', async () => {
    // The measured shape: a hardcoded en-US default rather than user intent.
    const res = await req({'Accept-Language': 'en-US,en;q=0.9'})
    expect(res.status).toBe(200)
    expect(res.headers.get('Location')).toBeNull()
    expect(byId(await res.text(), 'locale')).toBe('en')
  })
})

describe('hydration parity', () => {
  it('hands the client the server-negotiated locale', async () => {
    const html = await (await req({Cookie: 'locale=de'})).text()
    const data = envelope(html)
    expect(data, `no hydration envelope in:\n${html.slice(0, 300)}`).toBeDefined()

    // The client reads THIS rather than navigator.language, so it cannot disagree.
    expect(data.i18n.locale).toBe('de')
    expect(data.i18n.defaultLocale).toBe('en')
    expect(data.i18n.locales).toEqual(['en', 'de', 'fr'])
    expect(data.i18n.localeWasExplicit).toBe(true)
  })

  it('matches what the markup rendered', async () => {
    const html = await (await req({'Accept-Language': 'fr'})).text()
    expect(envelope(html).i18n.locale).toBe(byId(html, 'locale'))
  })
})

describe('Vary', () => {
  it('names both headers that can change the rendered output', async () => {
    const vary = (await req()).headers.get('Vary')?.toLowerCase() ?? ''
    expect(vary).toContain('cookie')
    expect(vary).toContain('accept-language')
  })

  it('does not duplicate entries', async () => {
    const vary = (await req()).headers.get('Vary') ?? ''
    const seen = vary.split(',').map(v => v.trim().toLowerCase())
    expect(new Set(seen).size).toBe(seen.length)
  })
})
