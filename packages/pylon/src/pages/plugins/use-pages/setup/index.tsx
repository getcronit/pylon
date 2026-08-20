import fs from 'fs'
import path from 'path'
import reactServer from 'react-dom/server'

import {app, type Plugin} from '@getcronit/pylon'
import {createPylonQueryClient, createServerFetcher} from '@getcronit/pylon/query'
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
  appModule?: string
): Promise<string> {
  const bootstrapModules = appModule ? [appModule] : undefined
  if (reactServer.renderToReadableStream) {
    const stream = await reactServer.renderToReadableStream(component, {
      bootstrapModules
    })
    // Consuming the stream to a string waits for everything (incl. Suspense).
    return await new Response(stream as any).text()
  }
  if (reactServer.renderToString) {
    return reactServer.renderToString(component)
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

export const setup = async (
  app: Parameters<NonNullable<Plugin['setup']>>[0],
  options: {i18n?: I18nOptions} = {}
) => {
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

  await loadPages()

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
        if (sitemapModule.generateSitemaps) {
          const sitemaps = await sitemapModule.generateSitemaps()
          const indexItems = sitemaps.map((s: any) => ({
            url: `${baseUrl.origin}/sitemap/${s.id}.xml`
          }))
          xml = renderSitemapIndexXml(indexItems)
        } else {
          const sitemapFn = sitemapModule.sitemap || sitemapModule.default
          if (sitemapFn) {
            const items = await sitemapFn()
            xml = renderSitemapXml(items, baseUrl.origin)
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
          const items = await sitemapFn({id})
          xml = renderSitemapXml(items, baseUrl.origin)
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
    const pagesContext = c.get('pagesContext' as any) || {}
    // Dev (Topology A): bootstrap the browser from the Vite client entry (app.tsx +
    // hydration, served + HMR'd by Vite) instead of the hashed rolldown bundle.
    const devBridge = (globalThis as any).__PYLON_PAGES_DEV__
    const bootstrapEntry: string = devBridge?.clientEntry ?? staticManifest['app.js']
    // Per-request client with a request-bound fetcher: the in-process GraphQL
    // call forwards this request's headers and hits the mounted app directly,
    // avoiding AsyncLocalStorage (which React's async render breaks out of).
    const pagesClient = createPylonQueryClient({
      descriptor: _client.descriptor,
      fetcher: createServerFetcher(app as any, c.req.raw) as any
    })

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

    const renderComponent = (ctx: StaticHandlerContext) => (
      <__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider
        client={pagesClient}
        responseCookies={responseCookies}
        staticData={{context: pagesContext, i18n}}>
        <StaticRouterProvider
          router={createStaticRouter(routeHandler.dataRoutes, ctx)}
          context={ctx}
        />
      </__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider>
    )

    // =====================================================================
    // Render ONCE. Suspense drives useData fetching into the store during this
    // render; the hydration payload (window.__pylon) is appended to the HTML
    // afterwards. A second render happens ONLY on the error path (a component
    // threw a redirect/notFound/crash → populate context.errors → render the
    // error page).
    // =====================================================================
    let html: string
    try {
      html = await renderToHtml(renderComponent(context), bootstrapEntry)
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
        // Application crash (e.g. TypeError) → 500 boundary.
        const leafMatch = context.matches[context.matches.length - 1]
        if (leafMatch) {
          context.errors = context.errors || {}
          context.errors[leafMatch.route.id] = errorOrResponse
          context.statusCode = 500
        } else {
          throw errorOrResponse
        }
      }

      // Error path only: re-render with the populated error context.
      try {
        html = await renderToHtml(renderComponent(context), bootstrapEntry)
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

    // Append the operation-keyed hydration payload right before </body>. The
    // store can only be collected AFTER the render that populated it, so this
    // can't be embedded by the in-tree DataClientProvider (which already wrote
    // `window.__pylonStaticData = {context}` earlier in the body). Merge the
    // collected snapshot into that SAME envelope under `.cache` — that is what
    // inject-app-hydration.ts reads (`__pylonStaticData.cache`) and feeds to
    // `client.hydrate()`. Both are classic inline scripts, so they run in
    // document order before the deferred app.js calls hydrate().
    const payload = pagesClient.collect()
    const hasData =
      payload &&
      (Object.keys(payload.ops ?? {}).length > 0 ||
        Object.keys(payload.entities ?? {}).length > 0)
    if (hasData) {
      const script = `<script>window.__pylonStaticData = Object.assign(window.__pylonStaticData || {}, {cache: ${serializeForScript(payload)}})</script>`
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
import {canonicalRedirect, I18N_VARY, negotiate, type I18nOptions} from '../i18n'
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
  baseUrl: string
): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  for (const item of items) {
    const isAbsolute =
      item.url.startsWith('http://') || item.url.startsWith('https://')
    const loc = isAbsolute
      ? item.url
      : `${baseUrl}/${item.url.replace(/^\//, '')}`

    xml += `  <url>\n`
    xml += `    <loc>${escapeXml(loc)}</loc>\n`

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
