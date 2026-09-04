import fs from 'fs'
import path from 'path'
import reactServer from 'react-dom/server'

import {AsyncLocalStorage} from 'node:async_hooks'

import {app, type Plugin} from '@getcronit/pylon'
import {
  createPylonQueryClient,
  createServerFetcher,
  setOperationClientResolver,
  type PylonQueryClient
} from '@getcronit/pylon/query'
import {trimTrailingSlash} from 'hono/trailing-slash'
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
  type StaticHandlerContext
} from 'react-router'
import {PassThrough, Readable} from 'stream'

import ErrorPage from '@/pages/components/global-error-page'
import {etag} from 'hono/etag'
import {tmpdir} from 'os'
import {pipeline} from 'stream/promises'

import {Data, LayoutProps, MetadataRoute, PageProps} from '../types'

function isResponse(value: any): value is Response {
  return (
    value != null &&
    typeof value.status === 'number' &&
    typeof value.clone === 'function'
  )
}

/**
 * Render a React tree to a complete HTML string in one pass. Suspense awaits
 * each `useData` operation during this render, so by the time it resolves the
 * store is fully populated — there is NO separate data-probe pass. The document
 * shape is known at compile time; only the variable VALUES need a render (they
 * come from props/route assembled by the tree), so a single render suffices.
 *
 * Component-thrown Responses (redirect/404/403) surface as a shell error and
 * reject `renderToReadableStream`, so the caller's try/catch handles them.
 */
async function renderToHtml(
  component: React.ReactElement,
  appModule?: string,
  /**
   * The server→client state handoff (`window.__pylonStaticData = {...}`), emitted on
   * React's OWN bootstrap channel rather than as a node in the reconciled tree. This is
   * plumbing, not content: a `<script>` rendered in-tree is server-only (the client has no
   * data to re-render it from), so it becomes a hydration asymmetry that any app `<script>`
   * nearby then collides with. `bootstrapScriptContent` sidesteps that AND is streaming-safe
   * — React flushes it right after the shell, before the deferred app module, with no tree
   * node to reconcile. The post-render `cache` chunk is appended separately (it can only be
   * known AFTER the render that populates the store); it `Object.assign`s onto this envelope.
   */
  bootstrapScriptContent?: string
): Promise<string> {
  const bootstrapModules = appModule ? [appModule] : undefined
  if (reactServer.renderToReadableStream) {
    const stream = await reactServer.renderToReadableStream(component, {
      bootstrapModules,
      bootstrapScriptContent
    })
    // Consuming the stream to a string waits for everything (incl. Suspense).
    return await new Response(stream as any).text()
  }
  if (reactServer.renderToString) {
    // Fallback path: `renderToString` has no bootstrap channel, so inline the handoff
    // before `</body>` ourselves. (This path also emits no app module, so it is already a
    // degraded environment; parity is best-effort.)
    const html = reactServer.renderToString(component)
    if (!bootstrapScriptContent) return html
    const tag = `<script>${bootstrapScriptContent}</script>`
    return html.includes('</body>')
      ? html.replace('</body>', `${tag}</body>`)
      : html + tag
  }
  throw new Error('Environment not supported')
}

/** Escape a value for safe embedding inside an inline `<script>` tag. */
const serializeForScript = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/[\u003c\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))

export type {Data, LayoutProps, MetadataRoute, PageProps}

/**
 * The app root — the directory that CONTAINS `.pylon` — used to resolve build artifacts
 * (manifests, SSR route chunks, static/public files) at RUNTIME independent of the process
 * cwd. The generated `server.mjs` and `pylon dev` set `globalThis.__PYLON_ROOT__` from the
 * entry's own location, so a standalone deploy runs from ANY cwd. Falls back to `cwd`, which
 * is correct whenever the app is launched from its own directory (the historical behavior).
 */
const pylonRoot = (): string =>
  (globalThis as any).__PYLON_ROOT__ ?? process.cwd()

/**
 * Request-scoped client seam for the imperative `op` on the SERVER.
 *
 * `op` is a module-level singleton, but a server client must be per-request: it
 * forwards THIS request's headers and owns a store that must not leak across
 * requests. So instead of a global `registerOperationClient`, we bind the client
 * in AsyncLocalStorage around the module invocation and teach `op` to read it.
 * Concurrent requests each run inside their own `.run()`, so they never share a
 * client. Installed once at module load; a no-op in the browser (this module is
 * server-only). Generalizes to any non-React server caller (queue jobs, RSS).
 */
const opClientStore = new AsyncLocalStorage<PylonQueryClient>()
setOperationClientResolver(() => opClientStore.getStore())

/** Run `fn` with `client` bound as the request-scoped client `op` resolves. */
const runWithOperationClient = <T,>(
  client: PylonQueryClient,
  fn: () => T | Promise<T>
): Promise<T> => Promise.resolve(opClientStore.run(client, fn))

export const setup = async (
  app: Parameters<NonNullable<Plugin['setup']>>[0],
  options: {i18n?: I18nOptions; origin?: string; canonical?: boolean} = {}
) => {
  // Silent absence is the failure mode this whole feature exists to prevent, so say it once
  // at boot rather than letting a site ship with no alternates and no clue why.
  if (options.i18n && !options.origin) {
    console.warn(
      '[pylon] usePages({i18n}) without `origin`: no canonical or hreflang tags will be ' +
        'emitted, so search engines will treat each locale as an unrelated page. Set ' +
        "`origin: 'https://your-site.com'`."
    )
  }
  // Read manifests securely from JSON. Anchored at the app root (see pylonRoot), not cwd,
  // so a standalone deploy resolves them from the entry's location no matter the cwd.
  const root = pylonRoot()
  const pagesManifestPath = path.join(root, '.pylon/__pylon/pages/manifest.json')
  const staticManifestPath = path.join(root, '.pylon/__pylon/static/manifest.json')

  let pagesManifest: Record<string, string> = {}
  let staticManifest: Record<string, string> = {}
  // Mutable so the SSR catch-all reads the CURRENT routes/handler. In prod these
  // are set once (via loadPages below) and never change. The dev worker can hot-swap
  // pages by calling loadPages() again — re-reading the manifests + re-importing the
  // freshly-hashed SSR routes — with no app re-import, no DB reconnect, no plugin
  // re-setup. See rfcs/DEV_SERVER.md (Step 0/1).
  let routes: any
  // Definite-assignment: set by loadPages() (awaited before any request), which TS
  // can't see through the closure.
  let handler!: ReturnType<typeof createStaticHandler>
  /**
   * One static handler per locale, keyed by basename ('' = the unprefixed default).
   *
   * Prefix routing is React Router's `basename`, not a duplicated route table: the SAME
   * `routes` object is matched under `/de`, so `pages/` needs no `[locale]` folder. Locales
   * are known from config, so these are built once at load rather than per request.
   */
  const localeHandlers = new Map<string, ReturnType<typeof createStaticHandler>>()

  /** The handler for a basename, built on first use. `''` is the root handler. */
  const handlerFor = (basename: string | undefined) => {
    if (!basename) return handler
    let h = localeHandlers.get(basename)
    if (!h) {
      h = createStaticHandler(routes, {basename})
      localeHandlers.set(basename, h)
    }
    return h
  }

  // Load (or reload) the page layer into the mutable refs above. Reassigns local
  // refs + globals only — it introduces NO new dynamic imports beyond the existing
  // manifest-addressed routes import, so the prod entry stays statically traceable
  // for the nft standalone build (rfcs/DEV_SERVER.md §3.4).
  const loadPages = async () => {
    try {
      pagesManifest = JSON.parse(
        await fs.promises.readFile(pagesManifestPath, 'utf8')
      )
    } catch (err: any) {
      throw new Error('Failed to read pages manifest.json:', err)
    }

    try {
      staticManifest = JSON.parse(
        await fs.promises.readFile(staticManifestPath, 'utf8')
      )
      // Inject into global so root layout can generate links
      ;(globalThis as any).__PYLON_MANIFEST__ = staticManifest

      if (pagesManifest['version']) {
        ;(globalThis as any).__PYLON_VERSION__ = pagesManifest['version']
      }
    } catch (err: any) {
      throw new Error('Failed to read static manifest.json:', err)
    }

    // The SSR routes bundle is content-hashed (manifest-addressed), so re-importing
    // after a rebuild resolves a NEW specifier — cache-clean, no invalidation hack.
    routes = (await import(`${root}/${pagesManifest['app.js']}`)).default
    handler = createStaticHandler(routes)
    // Stale handlers close over the PREVIOUS routes object; a dev hot-swap would otherwise
    // keep serving the old tree on every prefixed URL.
    localeHandlers.clear()
  }

  /**
   * A top-level route whose segment IS a configured locale is unreachable under
   * `as-needed` prefixing.
   *
   * Only the single-segment case collides: `/de/de` is unambiguous (locale, then page) and
   * `/docs/de` never was, because a prefix only ever sits at position 0. But bare `/de` can
   * mean the German home page or the default-locale page named `de`, and the locale has to
   * win or an entire language becomes unreachable. Under `as-needed` the page then has NO
   * other URL, since `/en/de` 301s to `/de` — so it is silently dead.
   *
   * `always` prefixing has no collision at all (`/en/de` reaches the page), which is why
   * that is one of the two fixes offered. A warning rather than an error: the app may never
   * link the route, and failing a build over it would be disproportionate.
   */
  const warnLocaleShadowing = () => {
    const i18n = options.i18n
    if (!i18n) return
    if ((i18n.routing ?? 'prefix') !== 'prefix') return
    if ((i18n.prefix ?? 'as-needed') !== 'as-needed') return

    // Top-level segments = the children of the root route.
    const topLevel = new Set<string>()
    for (const root of (routes ?? []) as any[]) {
      for (const child of root?.children ?? []) {
        const seg = String(child?.path ?? '').replace(/^\//, '')
        if (seg && !seg.includes('/') && !seg.startsWith(':') && seg !== '*') {
          topLevel.add(seg.toLowerCase())
        }
      }
    }

    for (const locale of i18n.locales) {
      if (!topLevel.has(locale.toLowerCase())) continue
      console.warn(
        `[pylon] The route /${locale} is shadowed by the '${locale}' locale and is ` +
          `unreachable: /${locale} serves that locale's home page, and /${i18n.defaultLocale}/${locale} ` +
          `redirects back to it. Rename the route, or set prefix: 'always' so every locale ` +
          `carries a prefix and /${i18n.defaultLocale}/${locale} reaches the page.`
      )
    }
  }

  await loadPages()
  warnLocaleShadowing()

  /**
   * Loaded catalogs, keyed by locale. Loaded once and cached — a catalog is a static module,
   * so re-importing it per request would be pure overhead.
   */
  const catalogCache = new Map<string, Messages | null>()
  const catalogFor = async (locale: string): Promise<Messages | undefined> => {
    if (!options.i18n?.catalogs) return undefined
    if (catalogCache.has(locale)) return catalogCache.get(locale) ?? undefined
    let loaded: Messages | null = null
    try {
      // Emitted by the build hook from the configured `catalogs` directory, so the runtime
      // never has to resolve app-relative source paths.
      loaded = await loadCatalog(await import(`${root}/.pylon/messages/${locale}.js`))
    } catch {
      // A locale with no catalog falls back to the default; the build already warned.
      loaded = null
    }
    catalogCache.set(locale, loaded)
    return loaded ?? undefined
  }

  /**
   * The messages this render uses: the active locale merged OVER the default.
   *
   * Falling back once here means the browser receives a single, already-complete catalog —
   * it needs no fallback logic and never has to be sent the default locale as well.
   */
  const messagesFor = async (locale: string): Promise<Messages | undefined> => {
    const i18n = options.i18n
    if (!i18n?.catalogs) return undefined
    const active = await catalogFor(locale)
    if (locale === i18n.defaultLocale) return active
    const base = await catalogFor(i18n.defaultLocale)
    if (!base) return active
    return active ? mergeCatalogs(base, active) : base
  }

  // Dormant in prod (refs set once above; never called). The dev worker drives page
  // hot-swaps through this hook — see rfcs/DEV_SERVER.md (Step 1).
  ;(globalThis as any).__PYLON_DEV_RELOAD_PAGES__ = loadPages

  app.use(trimTrailingSlash() as any)

  const publicFilesPath = path.resolve(root, '.pylon', '__pylon', 'public')
  let publicFiles: string[] = []

  try {
    publicFiles = glob(`**/*`, {
      filesOnly: true,
      cwd: publicFilesPath
    })
  } catch (error) {
    // Ignore error
  }

  const sitemapCache = new Map<string, {xml: string; expiresAt: number}>()

  // Sitemap handlers

  if (pagesManifest['sitemap.js']) {
    try {
      const sitemapModule = await import(
        `${root}/${pagesManifest['sitemap.js']}`
      )

      // A sitemap module may call `op` to fetch its URLs from the app's OWN
      // GraphQL. Give it a per-request client with the in-process fetcher (same
      // recipe as the SSR path below), bound via `runWithOperationClient` so `op`
      // resolves it. `_client` is imported before any request handler runs, so
      // reading it here at request time is safe.
      const buildOpClient = (c: {req: {raw: {headers: Headers}}}) =>
        createPylonQueryClient({
          descriptor: _client.descriptor,
          fetcher: createServerFetcher(app as any, c.req.raw as any) as any
        })

      app.get('/sitemap.xml', async c => {
        const cacheKey = 'sitemap.xml'
        const cached = sitemapCache.get(cacheKey)
        const now = Date.now()
        const baseUrl = new URL(c.req.url)

        const revalidate = sitemapModule.revalidate
        if (revalidate === false || revalidate === 0) {
          c.header(
            'Cache-Control',
            'no-store, no-cache, must-revalidate, proxy-revalidate'
          )
        } else if (typeof revalidate === 'number') {
          c.header(
            'Cache-Control',
            `public, max-age=${revalidate}, s-maxage=${revalidate}, stale-while-revalidate`
          )
        }

        if (cached && cached.expiresAt > now) {
          c.header('Content-Type', 'application/xml')
          return c.body(cached.xml)
        }

        let xml: string = ''
        const opClient = buildOpClient(c)
        if (sitemapModule.generateSitemaps) {
          const sitemaps = await runWithOperationClient(opClient, () =>
            sitemapModule.generateSitemaps()
          )
          // Prefer the configured origin over the request host, exactly as the
          // shard/main renderers do — otherwise the index advertises shard URLs on
          // whatever `Host` the request carried (localhost, or a spoofed proxy host).
          const origin = options.origin ?? baseUrl.origin
          const indexItems = sitemaps.map((s: any) => ({
            url: `${origin}/sitemap/${s.id}.xml`
          }))
          xml = renderSitemapIndexXml(indexItems)
        } else {
          const sitemapFn = sitemapModule.sitemap || sitemapModule.default
          if (sitemapFn) {
            const items = await runWithOperationClient(opClient, () => sitemapFn())
            xml = renderSitemapXml(items, options.origin ?? baseUrl.origin, options.i18n)
          } else {
            return c.text('Sitemap not found', 404)
          }
        }

        if (typeof revalidate === 'number' && revalidate > 0) {
          sitemapCache.set(cacheKey, {
            xml,
            expiresAt: now + revalidate * 1000
          })
        }

        c.header('Content-Type', 'application/xml')
        return c.body(xml)
      })

      app.get('/sitemap/:id', async c => {
        const idParam = c.req.param('id')
        if (!idParam.endsWith('.xml')) {
          return c.text('Sitemap not found', 404)
        }
        const id = idParam.replace('.xml', '')

        const cacheKey = `sitemap-${id}.xml`
        const cached = sitemapCache.get(cacheKey)
        const now = Date.now()
        const baseUrl = new URL(c.req.url)

        const revalidate = sitemapModule.revalidate
        if (revalidate === false || revalidate === 0) {
          c.header(
            'Cache-Control',
            'no-store, no-cache, must-revalidate, proxy-revalidate'
          )
        } else if (typeof revalidate === 'number') {
          c.header(
            'Cache-Control',
            `public, max-age=${revalidate}, s-maxage=${revalidate}, stale-while-revalidate`
          )
        }

        if (cached && cached.expiresAt > now) {
          c.header('Content-Type', 'application/xml')
          return c.body(cached.xml)
        }

        let xml: string = ''
        const sitemapFn = sitemapModule.sitemap || sitemapModule.default

        if (sitemapFn) {
          const items = await runWithOperationClient(buildOpClient(c), () =>
            sitemapFn({id})
          )
          xml = renderSitemapXml(items, options.origin ?? baseUrl.origin, options.i18n)
        } else {
          return c.text('Sitemap not found', 404)
        }

        if (typeof revalidate === 'number' && revalidate > 0) {
          sitemapCache.set(cacheKey, {
            xml,
            expiresAt: now + revalidate * 1000
          })
        }

        c.header('Content-Type', 'application/xml')
        return c.body(xml)
      })
    } catch (e) {
      console.error('Failed to load sitemap module:', e)
    }
  }

  app.on(
    'GET',
    publicFiles.map(file => `/${file}`),
    etag(),
    async c => {
      const publicFilePath = path.resolve(
        root,
        '.pylon',
        '__pylon',
        'public',
        c.req.path.replace('/', '')
      )

      return serveFilePath({filePath: publicFilePath, context: c})
    }
  )

  app.get('/__pylon/static/*', etag(), async c => {
    const filePath = path.resolve(
      root,
      '.pylon',
      '__pylon',
      'static',
      c.req.path.replace('/__pylon/static/', '')
    )

    return serveFilePath({filePath, context: c})
  })

  // Image optimization route
  app.get('/__pylon/image', async c => {
    try {
      const {
        src,
        w,
        h,
        q = '75',
        format = 'webp',
        lqip = 'false'
      } = c.req.query()

      if (!src) {
        return c.json({error: 'Missing parameters.'}, 400)
      }

      // Lazily create the cache dir (anchored at pylonRoot) on first use.
      await ensureImageCache()

      const isSrcAbsolute =
        src.startsWith('http://') || src.startsWith('https://')

      let imagePath: string

      if (isSrcAbsolute) {
        imagePath = await downloadImage(src)
      } else {
        if (!src.startsWith('/')) {
          return c.json({error: 'Invalid image path.'}, 400)
        }

        if (!src.startsWith('/__pylon/static/media')) {
          // Prefix it with the public directory
          imagePath = path.join(root, '.pylon', '__pylon', 'public', src)
        } else {
          imagePath = path.join(root, '.pylon', src)
        }
      }

      // Check cache first
      const cachedImageFileName = getCachedImagePath({
        src,
        width: w ? parseInt(w) : 0,
        height: h ? parseInt(h) : 0,
        quality: q,
        lqip: lqip === 'true',
        format: format as keyof FormatEnum
      })

      // Check if the image exists asynchronously
      try {
        await fs.promises.access(imagePath)
      } catch {
        try {
          imagePath = await downloadImage(src)
        } catch (error) {
          return c.json({error: 'Image not found'}, 404)
        }
      }

      if (IS_IMAGE_CACHE_POSSIBLE) {
        try {
          await fs.promises.access(cachedImageFileName)
          const stream = fs.createReadStream(cachedImageFileName)
          c.res.headers.set('Content-Type', getContentType(format))
          return c.body(Readable.toWeb(stream) as ReadableStream)
        } catch (e) {
          // Proceed to optimize and cache the image if it doesn't exist
        }
      }

      const sharp = (await import('sharp')).default

      // Get image metadata (width and height) to calculate aspect ratio
      const metadata = await sharp(imagePath).metadata()

      // Validate if the metadata contains width and height
      if (!metadata.width || !metadata.height) {
        return c.json(
          {
            error:
              'Invalid image metadata. Width and height are required for resizing.'
          },
          400
        )
      }

      // Calculate missing dimension
      const {width: finalWidth, height: finalHeight} = calculateDimensions(
        metadata.width,
        metadata.height,
        w ? parseInt(w) : undefined,
        h ? parseInt(h) : undefined
      )

      let imageFormat = format.toLowerCase()

      function isSupportedFormat(format: string): format is keyof FormatEnum {
        const supportedFormats = sharp.format
        return Object.keys(supportedFormats).includes(format)
      }

      if (!isSupportedFormat(imageFormat)) {
        throw new Error('Unsupported image format')
      }

      const quality = parseInt(q)

      let data = sharp(imagePath)

      if (lqip === 'true') {
        data = data
          .resize({
            width: Math.min(finalWidth ?? 16, 16),
            height: Math.min(finalHeight ?? 16, 16),
            fit: 'inside'
          })
          .toFormat('webp', {
            quality: 30,
            alphaQuality: 20,
            smartSubsample: true
          })
      } else {
        data = data.resize(finalWidth, finalHeight).toFormat(imageFormat, {
          quality
        })
      }

      if (IS_IMAGE_CACHE_POSSIBLE) {
        const image = await data.toFile(cachedImageFileName)
        c.res.headers.set('Content-Type', getContentType(image.format))

        return c.body(
          Readable.toWeb(
            fs.createReadStream(cachedImageFileName)
          ) as unknown as ReadableStream
        )
      } else {
        const image = await data.toBuffer({resolveWithObject: true})
        c.res.headers.set('Content-Type', getContentType(image.info.format))

        return c.body(image.data as any)
      }
    } catch (error) {
      console.error('Error processing the image:', error)
      return c.json({error: 'Error processing the image'}, 500)
    }
  })

  const _client = await import(
    `${root}/.pylon/client/index.js?t=${Date.now()}`
  )

  app.get('*', async c => {
    // Dev rebuild latch: if a pages rebuild is in flight, wait for it (and its manifest
    // reload) to finish before rendering. Vite serves the client on-demand (always current),
    // but the SSR bundle is a rolldown artifact that lags a rebuild by ~100ms — so a reload
    // landing mid-rebuild would SSR the OLD bundle while the client loads the NEW code, i.e. a
    // hydration mismatch. Holding the render until the rebuild settles makes the two planes
    // consistent by construction. The global is only ever set by the dev supervisor, so this
    // is a single `undefined` check (no-op) in production. Loop so a rebuild that starts during
    // the wait is also awaited; rebuilds are single-flight, so it settles.
    let inFlight: Promise<void> | undefined
    while ((inFlight = (globalThis as any).__PYLON_DEV_REBUILD__)) {
      await inFlight
    }
    const pagesContext = c.get('pagesContext' as any) || {}
    // Dev (Topology A): bootstrap the browser from the Vite client entry (app.tsx +
    // hydration, served + HMR'd by Vite) instead of the hashed rolldown bundle.
    const devBridge = (globalThis as any).__PYLON_PAGES_DEV__
    const bootstrapEntry: string = devBridge?.clientEntry ?? staticManifest['app.js']
    // Locale negotiation. Opt-in, and deliberately REPORT-ONLY: it returns a locale and
    // nothing else, so there is no redirect for this handler to accidentally perform. See
    // ../i18n.ts for why redirecting on Accept-Language breaks search and AI crawlers.
    const i18n = options.i18n
      ? negotiate(options.i18n, {
          pathname: new URL(c.req.url).pathname,
          cookie: getCookie(c, options.i18n.cookie ?? 'locale'),
          acceptLanguage: c.req.header('accept-language')
        })
      : undefined

    // Per-request client with a request-bound fetcher: the in-process GraphQL
    // call forwards this request's headers and hits the mounted app directly,
    // avoiding AsyncLocalStorage (which React's async render breaks out of).
    const pagesClient = createPylonQueryClient({
      descriptor: _client.descriptor,
      fetcher: createServerFetcher(app as any, c.req.raw) as any,
      // Supplied to `@inContext` documents. Per REQUEST, not module-level: concurrent
      // renders in different locales share this process.
      locale: i18n?.locale
    })

    // The one redirect prefix routing owes: collapse a non-canonical URL onto the canonical
    // one. Deterministic — path + config only, never a cookie or Accept-Language — so a
    // crawler follows it to a stable target instead of being funnelled to one locale.
    if (options.i18n) {
      const url = new URL(c.req.url)
      const canonical = canonicalRedirect(options.i18n, url.pathname)
      if (canonical !== undefined && canonical !== url.pathname) {
        return c.redirect(`${canonical}${url.search}`, 301)
      }
    }

    const messages = i18n ? await messagesFor(i18n.locale) : undefined

    // Per-request cookie collector. The tree writes into it during render (via
    // `useResponseCookies`); `flushCookies()` drains it into `c` before any response is
    // built. Safe because the render is fully buffered — see pages/response-cookies.ts.
    const responseCookies =
      __PYLON_INTERNALS_DO_NOT_USE.createResponseCookies()
    const flushCookies = () => {
      const entries = responseCookies.entries()
      if (entries.length === 0) return

      // Secure-by-default, overridable. Hono's own defaults are `Path=/` and nothing else.
      // `SameSite=Lax` blocks the cookie on cross-site subrequests (CSRF surface) while
      // keeping it on top-level navigations, which is what a preference cookie needs.
      // `Secure` only when the request actually arrived over TLS, so http://localhost in
      // development still works. An explicit option always wins.
      const https =
        c.req.url.startsWith('https:') ||
        c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'

      for (const {name, value, options} of responseCookies.entries()) {
        const withDefaults = {
          sameSite: 'Lax',
          ...(https ? {secure: true} : {}),
          ...options
        }
        if (value === null) deleteCookie(c, name, withDefaults as any)
        else setCookie(c, name, value, withDefaults as any)
      }

      // A response carrying Set-Cookie must never be stored by a SHARED cache — one
      // visitor's cookie would be replayed to everyone else. Most CDNs decline to cache
      // Set-Cookie responses, but that is convention, not a guarantee, and some are
      // configured to strip the header and cache the body. Only set it when the app has
      // not chosen its own policy.
      if (!c.res.headers.has('Cache-Control')) {
        c.header('Cache-Control', 'private, no-cache')
      }
    }

    // =====================================================================
    // PHASE 1: Route Matching & Loader Execution
    // =====================================================================
    // Prefix routing: match under the locale's basename so `/de/pricing` resolves the same
    // route `/pricing` does. React Router strips the basename itself.
    const routeHandler = handlerFor(i18n?.basename)
    const staticHandlerContext = await routeHandler.query(c.req.raw, {
      requestContext: {pagesContext}
    })

    // Handle redirects or raw responses thrown by standard React Router loaders
    if (isResponse(staticHandlerContext)) {
      const status = staticHandlerContext.status
      if (status >= 300 && status < 400) {
        const location = staticHandlerContext.headers.get('Location')
        if (location) return c.redirect(location, status as any)
      }
      c.status(status as any)
      return c.body(await staticHandlerContext.text())
    }

    const context = staticHandlerContext as StaticHandlerContext

    // Canonical + hreflang for THIS page. Computed AFTER routing so the status is known:
    // a 404 must not advertise itself as a canonical page with translations, which would
    // invite search engines to index a URL that does not exist. Also skipped without an
    // `origin`, since both tags require absolute URLs.
    //
    // Canonical and hreflang are SEPARATE concerns that used to share a
    // condition. Alternates need `i18n` — locale basenames are the whole point.
    // A canonical does not: it is this page's own URL, so requiring i18n left a
    // single-locale site with `origin` emitting neither.
    const metadata =
      options.origin && (context.statusCode ?? 200) < 400
        ? (() => {
            const full = new URL(c.req.url).pathname
            const origin = options.origin!.replace(/\/$/, '')

            if (!i18n) {
              return {
                canonical:
                  options.canonical === false ? undefined : `${origin}${full}`,
                alternates: []
              }
            }

            // Strip the active locale's basename to get the path every locale shares.
            const shared = i18n.basename ? full.slice(i18n.basename.length) || '/' : full
            const {byLocale, alternates} = localeUrls(options.i18n!, options.origin!, shared)
            return {
              canonical:
                options.canonical === false ? undefined : byLocale[i18n.locale],
              alternates
            }
          })()
        : undefined

    const renderComponent = (ctx: StaticHandlerContext) => (
      <__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider
        client={pagesClient}
        responseCookies={responseCookies}
        staticData={{context: pagesContext, i18n, metadata, messages}}>
        <StaticRouterProvider
          router={createStaticRouter(routeHandler.dataRoutes, ctx)}
          context={ctx}
        />
      </__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider>
    )

    // The half of the hydration envelope known BEFORE render (auth/features/role context,
    // negotiated locale, active messages). Emitted via React's bootstrap channel (see
    // renderToHtml) as `window.__pylonStaticData = {...};` — the exact shape the client
    // provider reads and the serve tests assert. `cache` is NOT here: it is only known after
    // the render populates the store, so it is appended below and `Object.assign`ed on.
    const bootstrapData = {
      ...(pagesContext ? {context: pagesContext} : {}),
      ...(i18n ? {i18n} : {}),
      ...(messages ? {messages} : {})
    }
    const bootstrapScriptContent =
      Object.keys(bootstrapData).length > 0
        ? `window.__pylonStaticData = ${serializeForScript(bootstrapData)};`
        : undefined

    // The operation-keyed hydration payload, as a trailing inline script. The store is only
    // complete AFTER the render, so this is emitted at the end (flush() when streaming, or a
    // `</body>` splice when buffered). `Object.assign`s onto the bootstrap envelope. Empty
    // string when there is nothing to hydrate.
    const cacheScript = (): string => {
      const payload = pagesClient.collect()
      const hasData =
        payload &&
        (Object.keys(payload.ops ?? {}).length > 0 ||
          Object.keys(payload.entities ?? {}).length > 0)
      return hasData
        ? `<script>window.__pylonStaticData = Object.assign(window.__pylonStaticData || {}, {cache: ${serializeForScript(payload)}})</script>`
        : ''
    }

    // =====================================================================
    // STREAMING SEND PATH (rfcs/PAGES_STREAMING.md).
    //
    // Always attempted in prod: React resolves `renderToReadableStream` at SHELL-ready (before
    // pending Suspense boundaries resolve), so the shell flushes early and each boundary streams
    // in as its data arrives. With NO boundary (no `loading.tsx`, no manual `<Suspense>`) the
    // shell IS the whole document, so this degenerates to the buffered result — no behavioral
    // difference. That is also why status/containment stay correct there: any throw is a SHELL
    // error, which rejects the promise BEFORE a byte flushes, so we fall through to the buffered
    // path (below) and its re-render draws the errorElement server-side with the right status.
    //
    // The tradeoff is scoped to routes that DO put a boundary in the way: a `useData` failure or
    // `notFound()` BELOW the flush line can no longer change the status (200) or be contained
    // server-side — React aborts that boundary and the client re-renders it (RR's errorElement
    // then contains it client-side). See the RFC.
    //
    // Dev is excluded: the Vite HTML transform needs the whole document as a string.
    if (!devBridge && reactServer.renderToReadableStream) {
      let reactStream: ReadableStream | undefined
      try {
        reactStream = await reactServer.renderToReadableStream(
          renderComponent(context),
          {
            bootstrapModules: bootstrapEntry ? [bootstrapEntry] : undefined,
            bootstrapScriptContent,
            onError(err: unknown) {
              // Thrown Responses (notFound/redirect) are control flow, not errors. A real error
              // here is a post-flush boundary failure (the pre-flush/shell case rejects the
              // promise and is handled by the buffered fallback below).
              if (!isResponse(err)) {
                console.error('[pylon] streaming render error', err)
              }
            }
          }
        )
      } catch {
        // Shell error: nothing flushed. Leave `reactStream` unset and fall through to the
        // buffered path, which re-renders with full error containment + correct status.
        reactStream = undefined
      }

      if (reactStream) {
        // Shell rendered cleanly. Commit the response now — before the shell bytes go out — then
        // stream, appending the (post-render) cache payload once React closes the source stream.
        const encoder = new TextEncoder()
        const withCache = reactStream.pipeThrough(
          new TransformStream({
            flush(controller) {
              // Source close == React `allReady` == store fully populated.
              const script = cacheScript()
              if (script) controller.enqueue(encoder.encode(script))
            }
          })
        )

        flushCookies()
        if (i18n) {
          for (const header of I18N_VARY) appendVary(c.res.headers, header)
        }
        c.status(context.statusCode as any)
        c.header('Content-Type', 'text/html')
        return c.body(withCache as any)
      }
    }

    // =====================================================================
    // BUFFERED SEND PATH. Runs in dev, when streaming is unavailable, or as the shell-error
    // fallback above. Renders ONCE; a SECOND render happens only on the error path (a component
    // threw a redirect/notFound/crash → populate context.errors → render the error page).
    // =====================================================================
    let html: string
    try {
      html = await renderToHtml(
        renderComponent(context),
        bootstrapEntry,
        bootstrapScriptContent
      )
    } catch (errorOrResponse) {
      if (isResponse(errorOrResponse)) {
        const status = errorOrResponse.status

        // Component-level redirect (e.g. auth check). A render already ran, so any cookie
        // it queued (e.g. persisting a negotiated locale) must still be sent.
        if (status >= 300 && status < 400) {
          const location = errorOrResponse.headers.get('Location')
          if (location) {
            flushCookies()
            return c.redirect(location, status as any)
          }
        }

        // Component-level data error (404/403): hand it to React Router so the
        // error boundary renders.
        const leafMatch = context.matches[context.matches.length - 1]
        if (leafMatch) {
          let errorData = errorOrResponse.statusText
          try {
            errorData = await errorOrResponse.text()
          } catch {}
          context.errors = context.errors || {}
          context.errors[leafMatch.route.id] = {
            status,
            statusText: errorOrResponse.statusText,
            data: errorData,
            internal: true
          }
          context.statusCode = status
        }
      } else {
        // Application crash (a component threw during render — most commonly a
        // `useData` read whose operation failed). React Router renders a route's
        // `errorElement` in place of that route (and its subtree) when the error is
        // in `context.errors[routeId]` — and does so SERVER-SIDE, unlike a React
        // error boundary, which React 19 defers to the client. So localizing the
        // failure to the RIGHT route is what contains it: the failing segment shows
        // its boundary while ancestor chrome (and sibling branches) still render.
        //
        // `useData` tags each read with its owning route id; pick the SHALLOWEST
        // matched route whose read failed, so its boundary subsumes any deeper
        // failure. Fall back to the leaf when the error can't be localized (e.g. a
        // non-`useData` crash, so nothing was tagged) — the pre-existing behavior.
        const matches = context.matches
        const failed = pagesClient.failedOwners()
        const target =
          matches.find(m => failed.has(m.route.id)) ??
          matches[matches.length - 1]
        if (target) {
          context.errors = context.errors || {}
          context.errors[target.route.id] = errorOrResponse
          context.statusCode = 500
        } else {
          throw errorOrResponse
        }
      }

      // Error path only: re-render with the populated error context.
      try {
        html = await renderToHtml(
        renderComponent(context),
        bootstrapEntry,
        bootstrapScriptContent
      )
      } catch (criticalError) {
        console.error('CRITICAL RENDER ERROR', criticalError)
        flushCookies()
        c.status(500)
        c.header('Content-Type', 'text/html')
        return c.html(
          reactServer.renderToString(<ErrorPage error={criticalError as Error} />)
        )
      }
    }

    // Splice the operation-keyed hydration payload in right before </body>. Same envelope as the
    // pre-render bootstrap script; see cacheScript().
    const script = cacheScript()
    if (script) {
      html = html.includes('</body>')
        ? html.replace('</body>', `${script}</body>`)
        : html + script
    }

    // Dev: let Vite inject `@vite/client` + the React-Refresh preamble (Fast Refresh)
    // and rewrite module URLs. Runs last, on the complete HTML (hydration payload incl.).
    if (devBridge) {
      html = await devBridge.transformHtml(c.req.url, html)
    }

    flushCookies()
    if (i18n) {
      // Both headers can change the rendered output: in cookie mode they pick the locale,
      // in prefix mode they feed `suggestedLocale`, which is rendered.
      for (const header of I18N_VARY) appendVary(c.res.headers, header)
    }
    c.status(context.statusCode as any)
    c.header('Content-Type', 'text/html')
    return c.html(html)
  })
}

import {__PYLON_INTERNALS_DO_NOT_USE} from '@getcronit/pylon/pages'
import {deleteCookie, getCookie, setCookie} from '@getcronit/pylon'
import {
  loadCatalog,
  mergeCatalogs,
  type Messages
} from '../catalog'
import {
  canonicalRedirect,
  I18N_VARY,
  localeUrls,
  localizeSitemapUrl,
  negotiate,
  type I18nOptions,
  type LocaleAlternate
} from '../i18n'
import {appendVary} from '../../vary'
import {createHash} from 'crypto'
import type {FormatEnum} from 'sharp'
import glob from 'tiny-glob/sync.js'
import {serveFilePath} from './serve-file-path'

// Cache directory

// Resolved LAZILY (on the first image request), not at module import: pylonRoot() is set by
// the boot glue AFTER this module is imported, so an eager `.cache` path would freeze to the
// wrong (cwd) location. `.cache/__pylon/images` under the app root; if it can't be created
// (read-only FS), caching degrades off gracefully.
let IS_IMAGE_CACHE_POSSIBLE = true
let _imageCacheDir: string | undefined
const imageCacheDir = (): string =>
  (_imageCacheDir ??= path.join(pylonRoot(), '.cache/__pylon/images'))

let _imageCacheEnsured = false
const ensureImageCache = async (): Promise<void> => {
  if (_imageCacheEnsured) return
  _imageCacheEnsured = true
  try {
    await fs.promises.mkdir(imageCacheDir(), {recursive: true})
  } catch {
    IS_IMAGE_CACHE_POSSIBLE = false
  }
}

// Helper function to generate the cached image path
const getCachedImagePath = (args: {
  src: string
  width: number
  height: number
  quality: string
  lqip: boolean
  format: keyof FormatEnum
}) => {
  const fileName = `${path.basename(
    createHash('md5').update(JSON.stringify(args)).digest('hex'),
    path.extname(args.src)
  )}-${args.width}x${args.height}.${args.format}`
  return path.join(imageCacheDir(), fileName)
}

const getValuesFromCachedImagePath = (cachedImagePath: string) => {
  const fileName = path.basename(cachedImagePath)
  const [hash, dimensions, format] = fileName.split('.')
  const [width, height] = dimensions.split('x').map(Number)
  return {hash, width, height, format}
}

// Utility function to calculate missing dimension based on aspect ratio
const calculateDimensions = (
  originalWidth: number,
  originalHeight: number,
  width?: number,
  height?: number
) => {
  if (!width && !height) {
    return {width: originalWidth, height: originalHeight}
  }
  // Never enlarge. A `srcset` offers candidate widths without knowing how big
  // the source actually is, so a 2000px master asked for 3840 would otherwise
  // be upscaled — a bigger file that looks worse than the original. Clamping
  // makes an oversized candidate collapse onto the real maximum instead.
  if (width) width = Math.min(width, originalWidth)
  if (height) height = Math.min(height, originalHeight)
  if (width && !height) {
    // Calculate height based on the aspect ratio
    height = Math.round((width * originalHeight) / originalWidth)
  } else if (height && !width) {
    // Calculate width based on the aspect ratio
    width = Math.round((height * originalWidth) / originalHeight)
  }
  return {width, height}
}

// Helper function to get the correct Content-Type based on the format
const getContentType = (format: string) => {
  switch (format.toLowerCase()) {
    case 'webp':
      return 'image/webp'
    case 'jpeg':
    case 'jpg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream' // Fallback type if format is unknown
  }
}

const downloadImage = async (url: string): Promise<string> => {
  const isSrcAbsoluteUrl =
    url.startsWith('http://') || url.startsWith('https://')
  const _fetch = isSrcAbsoluteUrl ? fetch : app.request

  const response = await _fetch(url)
  if (!response.ok)
    throw new Error(`Failed to download image: ${response.statusText}`)

  const ext = path.extname(url) || '.jpg'
  const tempFilePath = path.join(tmpdir(), `image-${Date.now()}${ext}`)

  const fileStream = fs.createWriteStream(tempFilePath)

  await pipeline(response.body!, fileStream)

  return tempFilePath
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case "'":
        return '&apos;'
      case '"':
        return '&quot;'
    }
    return c
  })
}

function renderSitemapXml(
  items: MetadataRoute.SitemapItem[],
  baseUrl: string,
  i18n?: I18nOptions
): string {
  // Each declared URL becomes one entry per locale, so a localized site does not advertise
  // only its default language. `undefined` = not localized (no i18n, cookie routing, or the
  // app wrote the prefix itself), in which case the URL is emitted verbatim as before.
  const expanded = items.flatMap(item => {
    const localized = i18n
      ? localizeSitemapUrl(i18n, baseUrl, item.url)
      : undefined
    if (!localized) {
      const isAbsolute =
        item.url.startsWith('http://') || item.url.startsWith('https://')
      const loc = isAbsolute
        ? item.url
        : `${baseUrl}/${item.url.replace(/^\//, '')}`
      return [{item, loc, alternates: undefined as LocaleAlternate[] | undefined}]
    }
    return localized.map(l => ({item, loc: l.loc, alternates: l.alternates}))
  })

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  // The xhtml namespace is what makes <xhtml:link> alternates legal in a sitemap.
  xml += i18n
    ? `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`
    : `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  for (const {item, loc, alternates} of expanded) {
    xml += `  <url>\n`
    xml += `    <loc>${escapeXml(loc)}</loc>\n`
    for (const a of alternates ?? []) {
      xml += `    <xhtml:link rel="alternate" hreflang="${escapeXml(a.hreflang)}" href="${escapeXml(a.href)}"/>\n`
    }

    if (item.lastmod) {
      const date =
        item.lastmod instanceof Date
          ? item.lastmod.toISOString().split('T')[0]
          : item.lastmod
      xml += `    <lastmod>${escapeXml(String(date))}</lastmod>\n`
    }
    if (item.changefreq) {
      xml += `    <changefreq>${escapeXml(item.changefreq)}</changefreq>\n`
    }
    if (item.priority !== undefined) {
      xml += `    <priority>${item.priority}</priority>\n`
    }
    xml += `  </url>\n`
  }
  xml += `</urlset>`
  return xml
}

function renderSitemapIndexXml(items: MetadataRoute.SitemapIndex): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`

  xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  for (const item of items) {
    xml += `  <sitemap>\n`
    xml += `    <loc>${escapeXml(item.url)}</loc>\n`
    if (item.lastmod) {
      const date =
        item.lastmod instanceof Date
          ? item.lastmod.toISOString().split('T')[0]
          : item.lastmod
      xml += `    <lastmod>${escapeXml(String(date))}</lastmod>\n`
    }
    xml += `  </sitemap>\n`
  }
  xml += `</sitemapindex>`
  return xml
}
