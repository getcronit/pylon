/**
 * Message catalogs — P3 of rfcs/SSR_I18N.md, against a running app.
 *
 * Typing is the headline (keys AND placeholders inferred from the default catalog, no
 * codegen) but types are checked by `tsc`, not here. What only a served app proves:
 *
 *   - the right locale's copy is in the FIRST byte of HTML, interpolated,
 *   - a locale whose catalog is incomplete falls back to the default — resolved ONCE on the
 *     server, so the browser gets a single complete catalog rather than two to search,
 *   - and therefore the client receives EXACTLY ONE locale's messages. That is what makes
 *     "only the active locale ships" true, and it is invisible to a type test.
 *
 * The fixture's French catalog is JSON and deliberately missing `checkout.empty`, which
 * exercises both the JSON path and the fallback at once.
 */
import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {existsSync, promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon/dist/cli/index.js')
const appDir = path.resolve(dir, '../fixtures/i18n-catalog-app')
const pylonDir = path.join(appDir, '.pylon')

const PORT = 4795
const base = `http://localhost:${PORT}`
let server: ChildProcess | undefined
let serverLog = ''

const html = async (p: string) => (await fetch(`${base}${p}`)).text()
const byId = (h: string, id: string) => h.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1]
const envelope = (h: string) =>
  JSON.parse(h.match(/window\.__pylonStaticData = (\{.*?\});/)![1])

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
      await fetch(base)
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

describe('translated copy is server-rendered', () => {
  it('renders the default locale', async () => {
    expect(byId(await html('/'), 'home')).toBe('Home')
  })

  it('renders a translated locale from a .ts catalog', async () => {
    expect(byId(await html('/de'), 'home')).toBe('Startseite')
  })

  it('renders a translated locale from a .json catalog', async () => {
    // JSON is fine for translations — only the DEFAULT catalog must be .ts, because it is
    // the type source.
    expect(byId(await html('/fr'), 'home')).toBe('Accueil')
  })

  it('interpolates placeholders', async () => {
    expect(byId(await html('/de'), 'total')).toContain('für 3 Artikel')
  })

  it('formats numbers per locale via Intl', async () => {
    // Same value, same code — different output, because useFormatter binds the locale.
    expect(byId(await html('/'), 'total')).toContain('€12.50')
    expect(byId(await html('/de'), 'total')).toContain('12,50')
  })
})

describe('fallback to the default locale', () => {
  it('fills a key the translation omits', async () => {
    // fr.json has no `checkout.empty`.
    expect(byId(await html('/fr'), 'empty')).toBe('Your cart is empty')
    // …while its own keys are untouched.
    expect(byId(await html('/fr'), 'home')).toBe('Accueil')
  })

  it('resolves the fallback on the SERVER, shipping one complete catalog', async () => {
    // The browser gets a single merged object — no fallback logic, and no need to send the
    // default locale as a second catalog.
    const {messages} = envelope(await html('/fr'))
    expect(messages.checkout.empty).toBe('Your cart is empty')
    expect(messages.nav.home).toBe('Accueil')
  })
})

describe('only the active locale ships', () => {
  it('sends exactly one locale of messages to the client', async () => {
    const de = await html('/de')
    expect(de).toContain('Startseite')
    // No other locale's copy anywhere in the document.
    expect(de).not.toContain('Accueil')
    expect(de).not.toContain('"Home"')
  })

  it('keeps catalogs out of the client bundle entirely', async () => {
    // Catalogs are server-only; the client receives DATA. If they had been bundled, the
    // app chunk would contain copy from every locale.
    const appJs = (await html('/')).match(/src="(\/__pylon\/static\/app-[^"]+\.js)"/)![1]
    const bundle = await (await fetch(`${base}${appJs}`)).text()
    for (const copy of ['Startseite', 'Accueil', 'Warenkorb']) {
      expect(bundle, copy).not.toContain(copy)
    }
  })
})
