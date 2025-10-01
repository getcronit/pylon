import fs from 'fs'
import path from 'path'
import reactServer from 'react-dom/server'

import {app, Env, getEnv, Variables, type Plugin} from '@/index'
import {trimTrailingSlash} from 'hono/trailing-slash'
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider
} from 'react-router'
import {PassThrough, Readable} from 'stream'

import ErrorPage from '@/components/global-error-page'
import {StatusPage} from '@/components/status-page'
import {MiddlewareHandler} from 'hono'
import {tmpdir} from 'os'
import {pipeline} from 'stream/promises'

export interface PageData {}

export type PageProps = {
  // @ts-expect-error
  context: Variables['pagesContext']
  data: PageData
  params: Record<string, string>
  searchParams: Record<string, string>
  path: string
}

export type LayoutProps = PageProps & {
  children: React.ReactNode
}

const disableCacheMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const env = getEnv()
  // Disable cache for all request for now
  // This is a temporary solution before we implement a proper cache control
  if (true || env.NODE_ENV === 'development') {
    c.header(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    )
    c.header('Pragma', 'no-cache')
    c.header('Expires', '0')
    c.header('Surrogate-Control', 'no-store')
  }

  return next()
}

export const setup: Plugin['setup'] = async app => {
  const cacheBustingSuffix = `?v=${Date.now()}`

  const routes = (await import(`${process.cwd()}/.pylon/__pylon/pages/app.js`))
    .default
  const client = await import(`${process.cwd()}/.pylon/client/index.js`)

  let handler = createStaticHandler(routes)

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

  app.on(
    'GET',
    publicFiles.map(file => `/${file}`),
    disableCacheMiddleware as any,
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

  app.get('/__pylon/static/*', disableCacheMiddleware as any, async c => {
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

  app.get('*', disableCacheMiddleware as any, async c => {
    const context = await handler.query(c.req.raw)

    if (context instanceof Response) {
      return context
    }

    const router = createStaticRouter(handler.dataRoutes, context)

    const component = (
      <__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider client={client}>
        <StaticRouterProvider router={router} context={context} />
      </__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider>
    )

    // Check if the request wants JSON, if so, prepare the data
    if (c.req.header('accept')?.includes('application/json')) {
      const context = c.get('pagesContext' as any) || {}
      let cacheSnapshot
      try {
        client.cache.clear()
        const data = await client.prepareReactRender(component)

        cacheSnapshot = data.cacheSnapshot
      } catch (error) {
        if (error instanceof Response) {
          return error
        }
      }

      return c.json({
        cacheSnapshot,
        context
      })
    }

    try {
      if (reactServer.renderToReadableStream) {
        try {
          const stream = await reactServer.renderToReadableStream(component, {
            bootstrapModules: ['/__pylon/static/app.js' + cacheBustingSuffix]
          })

          return c.body(stream)
        } catch (error) {
          throw error
        }
      } else if (reactServer.renderToPipeableStream) {
        return await new Promise<Response>((resolve, reject) => {
          const {pipe} = reactServer.renderToPipeableStream(
            component,

            {
              bootstrapModules: ['/__pylon/static/app.js' + cacheBustingSuffix],
              onShellReady: async () => {
                c.header('Content-Type', 'text/html')

                const passThrough = new PassThrough()

                pipe(passThrough)

                resolve(c.body(Readable.toWeb(passThrough) as any))
              },
              onShellError: async error => {
                reject(error)
              }
            }
          )
        })
      } else {
        throw new Error('Environment not supported')
      }
    } catch (errorOrResponse) {
      c.header('Content-Type', 'text/html')

      if (errorOrResponse instanceof Response) {
        c.status(errorOrResponse.status as StatusCode)

        // Redirect if the response is a redirect
        if (errorOrResponse.status >= 300 && errorOrResponse.status < 400) {
          const location = errorOrResponse.headers.get('Location')
          if (location) {
            return c.redirect(
              location,
              errorOrResponse.status as RedirectStatusCode
            )
          }
        }

        return c.html(
          reactServer.renderToString(
            <StatusPage
              code={errorOrResponse.status}
              title={errorOrResponse.statusText}
              message={errorOrResponse.statusText}
              standalone
            />
          )
        )
      }

      c.status(500)

      return c.html(
        reactServer.renderToString(
          <ErrorPage error={errorOrResponse as Error} />
        )
      )
    }
  })
}

import {__PYLON_INTERNALS_DO_NOT_USE} from '@getcronit/pylon/pages'
import {createHash} from 'crypto'
import {RedirectStatusCode, StatusCode} from 'hono/utils/http-status'
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
