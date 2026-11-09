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
const html_ = html
const byId = (h: string, id: string) => h.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1]
const envelope = (h: string) =>
  JSON.parse(h.match(/window\.__pylonStaticData = (\{.*?\});/)![1])

/**
 * The operation cache, embedded by a SECOND script after the render — the store can only be
 * collected once the render that populated it has finished, so it cannot ride the first
 * envelope.
 */
const cacheOf = (h: string): Record<string, unknown> => {
  const raw = h.match(/Object\.assign\(window\.__pylonStaticData \|\| \{\}, \{cache: (\{.*?\})\}\)/)
  return raw ? (JSON.parse(raw[1]).ops ?? {}) : {}
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

describe('plural messages', () => {
  it('selects a category per count', async () => {
    const h = await html('/')
    expect(byId(h, 'one')).toBe('1 item')
    expect(byId(h, 'many')).toBe('7 items')
  })

  it('uses the locale\'s own plural rules', async () => {
    // German happens to share the noun form here; the point is the SELECTION runs against
    // the active locale via Intl.PluralRules, not against English.
    const h = await html('/de')
    expect(byId(h, 'one')).toBe('1 Artikel')
    expect(byId(h, 'many')).toBe('7 Artikel')
  })

  it('ships plural branches as data, not as a parsed format string', async () => {
    // The envelope carries {one, other}; selection happens at render on both sides, so the
    // client needs no ICU parser.
    const {messages} = envelope(await html('/de'))
    expect(messages.checkout.items).toEqual({
      one: '{count} Artikel',
      other: '{count} Artikel'
    })
  })
})

describe('@inContext — resolvers see the locale', () => {
  it('localizes a RESOLVER-returned string from the URL prefix', async () => {
    // Not from the client catalog: `serverGreeting` is translated inside the resolver via
    // getLocale(), which reads the operation's @inContext.
    expect(byId(await html('/'), 'server')).toBe('Server: hello')
    expect(byId(await html('/de'), 'server')).toBe('Server: hallo')
    expect(byId(await html('/fr'), 'server')).toBe('Server: bonjour')
  })

  it('compiles the directive into the document', async () => {
    // Route modules are chunked, so walk the SSR page output rather than assuming a
    // flat directory.
    const root = path.join(appDir, '.pylon/__pylon/pages')
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = []
      for (const e of await fs.readdir(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) out.push(...(await walk(p)))
        else if (e.name.endsWith('.js')) out.push(p)
      }
      return out
    }
    const sources = await Promise.all(
      (await walk(root)).map(f => fs.readFile(f, 'utf8'))
    )
    const joined = sources.join('\n')
    // The variable declaration and the directive are inseparable — GraphQL rejects a
    // declared variable that is never used. `locale` may be followed by the per-operation
    // `context:` channel (`@inContext(locale: $__locale, context: $__context)`), so match the
    // locale argument tolerant of a trailing `, context: …`.
    expect(joined).toContain('$__locale: String')
    expect(joined).toMatch(/@inContext\(locale: \$__locale[,)]/)
  })

  it('gives each locale its OWN cache entry', async () => {
    // The reason the locale rides in the document rather than a header: pylon-query keys on
    // `documentId ~ variablesHash`, so with a header both locales would collide on one key
    // and one language would serve the other's data.
    const keysFor = async (p: string) => Object.keys(cacheOf(await html(p)))

    const [de, fr] = await Promise.all([keysFor('/de'), keysFor('/fr')])
    expect(de.length).toBeGreaterThan(0)
    expect(de).not.toEqual(fr)

    // Same DOCUMENT (id before `~`), different variables hash — one compiled document
    // serving every locale, which is why the id stays stable.
    expect(de[0].split('~')[0]).toBe(fr[0].split('~')[0])
    expect(de[0].split('~')[1]).not.toBe(fr[0].split('~')[1])
  })

  it('caches the locale-correct payload under that key', async () => {
    const cache = JSON.stringify(cacheOf(await html('/de')))
    expect(cache).toContain('Server: hallo')
    expect(cache).not.toContain('Server: bonjour')
  })
})

describe('the BROWSER client sends the locale too', () => {
  // SSR being right is only half of it: after hydration a refetch or a mutation is a plain
  // POST /graphql from the browser, with no page request anywhere. If the browser client
  // omitted `$__locale`, a refetch would silently return the DEFAULT locale's data and
  // overwrite the correct SSR result in the store.
  //
  // Verified in a real browser by patching `window.fetch` and clicking a refetch: the body
  // was `{"variables":{"__locale":"de"}}`. These assert the wiring that makes that true.
  it('reads the locale out of the hydration envelope', async () => {
    const client = await fs.readFile(
      path.join(appDir, '.pylon/client/index.ts'),
      'utf8'
    )
    expect(client).toContain('__pylonStaticData?.i18n?.locale')
    expect(client).toMatch(/createPylonQueryClient\(\{\.\.\.options, locale\}\)/)
  })

  it('ships that wiring in the client bundle', async () => {
    const html = await html_('/de')
    const src = html.match(/src="(\/__pylon\/static\/app-[^"]+\.js)"/)![1]
    const bundle = await (await fetch(`${base}${src}`)).text()
    // The envelope read must survive bundling — not be tree-shaken or renamed away.
    expect(bundle).toContain('__pylonStaticData')
    expect(bundle).toContain('__locale')
  })
})

describe('dev and prod compile the same documents', () => {
  // `pylon dev` builds the SSR bundle with the rolldown analyzer but the CLIENT bundle with
  // the Vite one. Only the rolldown path was told about i18n, so dev shipped a server that
  // knew the locale and a client that did not: SSR rendered German, then the first refetch
  // sent a directive-less document and the page flipped to English. Prod was unaffected,
  // which is the worst place for a difference to live.
  //
  // Reproduced in a browser against `pylon dev`: the wire carried
  // `query page_0 { serverGreeting }` with no variables, and the DOM went
  // "Server: hallo" → "Server: hello".
  it('threads the i18n flag into the dev (Vite) analyzer', async () => {
    const devServer = await fs.readFile(
      path.join(repoRoot, 'packages/pylon/src/pages/plugins/use-pages/dev/vite-dev-server.ts'),
      'utf8'
    )
    expect(devServer).toContain('inContext: options.inContext')
  })

  it('lets the dev server read the usePages options it needs', async () => {
    // `usePages` in dev is only a `pages/` directory check, so the plugin's real options are
    // the sole source for whether i18n is configured.
    const cli = await fs.readFile(
      path.join(repoRoot, 'packages/pylon/src/cli/dev/dev-server.ts'),
      'utf8'
    )
    expect(cli).toContain("p?.name === 'pages'")
    expect(cli).toContain('inContext: Boolean(pagesPlugin?.options?.i18n)')

    const plugin = await fs.readFile(
      path.join(repoRoot, 'packages/pylon/src/pages/plugins/use-pages/index.ts'),
      'utf8'
    )
    // Options are captured in the factory closure unless the plugin exposes them.
    expect(plugin).toMatch(/name: 'pages',[\s\S]*?options,/)
  })
})
