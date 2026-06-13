import fs from 'fs'
import path from 'path'
import reactServer from 'react-dom/server'

import {app, type Plugin} from '@getcronit/pylon'
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
    const pagesClient = _client.createPylonPagesClient()

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
    const router = createStaticRouter(handler.dataRoutes, context)

    const prerenderComponent = (
      <__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider
        client={pagesClient}
        staticData={{
          context: pagesContext
        }}>
        <StaticRouterProvider router={router} context={context} />
      </__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider>
    )

    let cacheSnapshot: object | undefined = undefined

    // =====================================================================
    // PHASE 2: Component Render & Data Probing
    // =====================================================================
    try {
      // Execute a "dry run" to trigger component-level data fetching
      const result = await pagesClient.prepareReactRender(prerenderComponent)
      cacheSnapshot = result.cacheSnapshot
    } catch (errorOrResponse) {
      if (isResponse(errorOrResponse)) {
        const status = errorOrResponse.status

        // 1. Intercept component-level Redirects (e.g., Auth checks)
        if (status >= 300 && status < 400) {
          const location = errorOrResponse.headers.get('Location')
          if (location) return c.redirect(location, status as any)
        }

        // 2. Intercept component-level Data Errors (e.g., 404, 403)
        const leafMatch = context.matches[context.matches.length - 1]

        if (leafMatch) {
          // Unpack the stream so the client can serialize it during hydration
          let errorData = errorOrResponse.statusText
          try {
            errorData = await errorOrResponse.text()
          } catch {}

          context.errors = context.errors || {}

          // Format the error exactly how React Router's internals expect it
          context.errors[leafMatch.route.id] = {
            status: status,
            statusText: errorOrResponse.statusText,
            data: errorData,
            internal: true
          }

          context.statusCode = status
        }
      } else {
        // 3. Intercept standard application crashes (e.g., TypeErrors)
        const leafMatch = context.matches[context.matches.length - 1]

        if (leafMatch) {
          context.errors = context.errors || {}
          context.errors[leafMatch.route.id] = errorOrResponse
          context.statusCode = 500
        } else {
          throw errorOrResponse
        }
      }
    }

    // =====================================================================
    // PHASE 3: Final Stream Output
    // =====================================================================
    const finalComponent = (
      <__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider
        client={pagesClient}
        staticData={{
          cache: cacheSnapshot,
          context: pagesContext
        }}>
        <StaticRouterProvider router={router} context={context} />
      </__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider>
    )

    try {
      if (reactServer.renderToReadableStream) {
        const stream = await reactServer.renderToReadableStream(
          finalComponent,
          {
            bootstrapModules: staticManifest['app.js']
              ? [staticManifest['app.js']]
              : undefined
          }
        )

        // Apply the finalized status code to the HTTP response header
        c.status(context.statusCode as any)
        c.header('Content-Type', 'text/html')
        return c.body(stream)
      } else if (reactServer.renderToPipeableStream) {
        return await new Promise<Response>((resolve, reject) => {
          const {pipe} = reactServer.renderToPipeableStream(finalComponent, {
            bootstrapModules: staticManifest['app.js']
              ? [staticManifest['app.js']]
              : undefined,
            onShellReady: async () => {
              c.status(context.statusCode as any)
              c.header('Content-Type', 'text/html')
              const passThrough = new PassThrough()
              pipe(passThrough)
              resolve(c.body(Readable.toWeb(passThrough) as any))
            },
            onShellError: async error => {
              reject(error)
            }
          })
        })
      } else {
        throw new Error('Environment not supported')
      }
    } catch (criticalError) {
      // Failsafe for catastrophic streaming errors
      console.error('CRITICAL STREAM ERROR', criticalError)
      c.status(500)
      c.header('Content-Type', 'text/html')
      return c.html(
        reactServer.renderToString(<ErrorPage error={criticalError as Error} />)
      )
    }
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
