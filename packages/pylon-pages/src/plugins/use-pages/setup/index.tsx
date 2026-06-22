import fs from 'fs'
import path from 'path'
import reactServer from 'react-dom/server'

import {app, type Plugin} from '@getcronit/pylon'
import {createPylonQueryClient, createServerFetcher} from '@getcronit/pylon-query'
import {trimTrailingSlash} from 'hono/trailing-slash'
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
  type StaticHandlerContext
} from 'react-router'
import {PassThrough, Readable} from 'stream'

import ErrorPage from '@/components/global-error-page'
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

export const setup: NonNullable<Plugin['setup']> = async app => {
  // Read manifests securely from JSON
  const pagesManifestPath = path.join(
    process.cwd(),
    '.pylon/__pylon/pages/manifest.json'
  )
  const staticManifestPath = path.join(
    process.cwd(),
    '.pylon/__pylon/static/manifest.json'
  )

  let pagesManifest: Record<string, string> = {}
  let staticManifest: Record<string, string> = {}

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

  const routes = (await import(`${process.cwd()}/${pagesManifest['app.js']}`))
    .default

  const handler = createStaticHandler(routes)

  app.use(trimTrailingSlash() as any)

  const publicFilesPath = path.resolve(
    process.cwd(),
    '.pylon',
    '__pylon',
    'public'
  )
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
        `${process.cwd()}/${pagesManifest['sitemap.js']}`
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
        process.cwd(),
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
      process.cwd(),
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
          imagePath = path.join(
            process.cwd(),
            '.pylon',
            '__pylon',
            'public',
            src
          )
        } else {
          imagePath = path.join(process.cwd(), '.pylon', src)
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
    `${process.cwd()}/.pylon/client/index.js?t=${Date.now()}`
  )

  app.get('*', async c => {
    const pagesContext = c.get('pagesContext' as any) || {}
    // Per-request client with a request-bound fetcher: the in-process GraphQL
    // call forwards this request's headers and hits the mounted app directly,
    // avoiding AsyncLocalStorage (which React's async render breaks out of).
    const pagesClient = createPylonQueryClient({
      descriptor: _client.descriptor,
      fetcher: createServerFetcher(app as any, c.req.raw) as any
    })

    // =====================================================================
    // PHASE 1: Route Matching & Loader Execution
    // =====================================================================
    const staticHandlerContext = await handler.query(c.req.raw, {
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
        staticData={{context: pagesContext}}>
        <StaticRouterProvider
          router={createStaticRouter(handler.dataRoutes, ctx)}
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
      html = await renderToHtml(renderComponent(context), staticManifest['app.js'])
    } catch (errorOrResponse) {
      if (isResponse(errorOrResponse)) {
        const status = errorOrResponse.status

        // Component-level redirect (e.g. auth check).
        if (status >= 300 && status < 400) {
          const location = errorOrResponse.headers.get('Location')
          if (location) return c.redirect(location, status as any)
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
        html = await renderToHtml(
          renderComponent(context),
          staticManifest['app.js']
        )
      } catch (criticalError) {
        console.error('CRITICAL RENDER ERROR', criticalError)
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

    c.status(context.statusCode as any)
    c.header('Content-Type', 'text/html')
    return c.html(html)
  })
}

import {__PYLON_INTERNALS_DO_NOT_USE} from '@getcronit/pylon-pages'
import {createHash} from 'crypto'
import type {FormatEnum} from 'sharp'
import glob from 'tiny-glob/sync.js'
import {serveFilePath} from './serve-file-path'

// Cache directory

const IMAGE_CACHE_DIR = path.join(process.cwd(), '.cache/__pylon/images')

let IS_IMAGE_CACHE_POSSIBLE = true

// Ensure the cache directory exists (if creating files is allowed)
try {
  await fs.promises.mkdir(IMAGE_CACHE_DIR, {recursive: true})
} catch (error) {
  IS_IMAGE_CACHE_POSSIBLE = false
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
  return path.join(IMAGE_CACHE_DIR, fileName)
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
