import fs from 'fs'
import path from 'path'
import reactServer from 'react-dom/server'

import {Env, getEnv, type Plugin} from '@/index'
import {UseHydrateCacheOptions} from '@gqty/react'
import {trimTrailingSlash} from 'hono/trailing-slash'
import {StaticRouter} from 'react-router'
import {PassThrough, Readable} from 'stream'
import {AppLoader} from './app-loader'

import ErrorPage from '@/components/global-error-page'
import {MiddlewareHandler} from 'hono'
import {tmpdir} from 'os'
import {pipeline} from 'stream/promises'
import {PageRoute} from '../build/app-utils'

export interface PageData {}

export type PageProps = {
  data: PageData
  params: Record<string, string>
  searchParams: Record<string, string>
  path: string
}

const disableCacheMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const env = getEnv()
  if (env.NODE_ENV === 'development') {
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

export const setup: Plugin['setup'] = app => {
  const pagesFilePath = path.resolve(process.cwd(), '.pylon', 'pages.json')

  let pageRoutes: PageRoute[] = []
  try {
    pageRoutes = JSON.parse(fs.readFileSync(pagesFilePath, 'utf-8'))
  } catch (error) {
    console.error('Error reading pages.json', error)
  }

  app.use(trimTrailingSlash() as any)

  let App: any = undefined
  let client: any = undefined

  app.on(
    'GET',
    pageRoutes.map(pageRoute => pageRoute.slug),
    disableCacheMiddleware as any,
    async c => {
      try {
        if (!App) {
          const module = await import(
            `${process.cwd()}/.pylon/__pylon/pages/app.js`
          )

          App = module.default
        }

        if (!client) {
          client = await import(`${process.cwd()}/.pylon/client/index.js`)
        }

        const requestUrl = new URL(c.req.url)

        let cacheSnapshot: UseHydrateCacheOptions | undefined = undefined

        try {
          const prepared = await client.prepareReactRender(
            <AppLoader
              Router={StaticRouter}
              routerProps={{
                location: {
                  pathname: requestUrl.pathname,
                  search: requestUrl.search,
                  hash: requestUrl.hash
                }
              }}
              App={App}
              client={client}
              pylonData={{
                cacheSnapshot: undefined
              }}
            />
          )

          cacheSnapshot = prepared.cacheSnapshot
        } catch (error) {}

        if (reactServer.renderToReadableStream) {
          try {
            const stream = await reactServer.renderToReadableStream(
              <AppLoader
                Router={StaticRouter}
                routerProps={{
                  location: c.req.path
                }}
                App={App}
                client={client}
                pylonData={{
                  cacheSnapshot: cacheSnapshot
                }}
              />,
              {
                bootstrapModules: ['/__pylon/static/app.js'],
                bootstrapScriptContent: `window.__PYLON_DATA__ = ${JSON.stringify(
                  {
                    cacheSnapshot: cacheSnapshot
                  }
                )}`
              }
            )

            return c.body(stream)
          } catch (error) {
            throw error
          }
        } else if (reactServer.renderToPipeableStream) {
          return await new Promise<Response>((resolve, reject) => {
            const {pipe} = reactServer.renderToPipeableStream(
              <AppLoader
                Router={StaticRouter}
                routerProps={{
                  location: c.req.path
                }}
                App={App}
                client={client}
                pylonData={{
                  cacheSnapshot: cacheSnapshot
                }}
              />,

              {
                bootstrapModules: ['/__pylon/static/app.js'],
                bootstrapScriptContent: `window.__PYLON_DATA__ = ${JSON.stringify(
                  {
                    cacheSnapshot: cacheSnapshot
                  }
                )}`,
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
      } catch (error) {
        c.header('Content-Type', 'text/html')
        c.status(500)

        return c.html(
          reactServer.renderToString(<ErrorPage error={error as any} />)
        )
      }
    }
  )

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

      try {
        await fs.promises.access(publicFilePath)

        if (publicFilePath.endsWith('.js')) {
          c.res.headers.set('Content-Type', 'text/javascript')
        } else if (publicFilePath.endsWith('.css')) {
          c.res.headers.set('Content-Type', 'text/css')
        } else if (publicFilePath.endsWith('.html')) {
          c.res.headers.set('Content-Type', 'text/html')
        } else if (publicFilePath.endsWith('.json')) {
          c.res.headers.set('Content-Type', 'application/json')
        } else if (publicFilePath.endsWith('.png')) {
          c.res.headers.set('Content-Type', 'image/png')
        } else if (
          publicFilePath.endsWith('.jpg') ||
          publicFilePath.endsWith('.jpeg')
        ) {
          c.res.headers.set('Content-Type', 'image/jpeg')
        } else if (publicFilePath.endsWith('.gif')) {
          c.res.headers.set('Content-Type', 'image/gif')
        } else if (publicFilePath.endsWith('.svg')) {
          c.res.headers.set('Content-Type', 'image/svg+xml')
        } else if (publicFilePath.endsWith('.ico')) {
          c.res.headers.set('Content-Type', 'image/x-icon')
        } else if (publicFilePath.endsWith('.map')) {
          c.res.headers.set('Content-Type', 'application/json')
        }

        const stream = fs.createReadStream(publicFilePath)

        const webStream = Readable.toWeb(stream) as unknown as ReadableStream

        return c.body(webStream)
      } catch {
        return c.status(404)
      }
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

    if (!fs.existsSync(filePath)) {
      return c.notFound()
    }

    if (filePath.endsWith('.js')) {
      c.res.headers.set('Content-Type', 'text/javascript')
    } else if (filePath.endsWith('.css')) {
      c.res.headers.set('Content-Type', 'text/css')
    } else if (filePath.endsWith('.html')) {
      c.res.headers.set('Content-Type', 'text/html')
    } else if (filePath.endsWith('.json') || filePath.endsWith('.map')) {
      c.res.headers.set('Content-Type', 'application/json')
    } else if (filePath.endsWith('.png')) {
      c.res.headers.set('Content-Type', 'image/png')
    } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      c.res.headers.set('Content-Type', 'image/jpeg')
    } else if (filePath.endsWith('.gif')) {
      c.res.headers.set('Content-Type', 'image/gif')
    } else if (filePath.endsWith('.svg')) {
      c.res.headers.set('Content-Type', 'image/svg+xml')
    } else if (filePath.endsWith('.ico')) {
      c.res.headers.set('Content-Type', 'image/x-icon')
    }

    const stream = fs.createReadStream(filePath)

    const webStream = Readable.toWeb(stream) as unknown as ReadableStream

    return c.body(webStream)
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

      let imagePath = path.join(process.cwd(), '.pylon', src)

      // Check cache first
      const cachedImageFileName = getCachedImagePath({
        src,
        width: w ? parseInt(w) : 0,
        height: h ? parseInt(h) : 0,
        quality: q,
        lqip: lqip === 'true',
        format: format as keyof FormatEnum
      })

      if (src.startsWith('http://') || src.startsWith('https://')) {
        imagePath = await downloadImage(src)
      }

      // Check if the image exists asynchronously
      try {
        await fs.promises.access(imagePath)
      } catch {
        return c.json({error: 'Image not found'}, 404)
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
}

import {createHash} from 'crypto'
import type {FormatEnum} from 'sharp'
import glob from 'tiny-glob/sync'

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
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Failed to download image: ${response.statusText}`)

  const ext = path.extname(new URL(url).pathname) || '.jpg'
  const tempFilePath = path.join(tmpdir(), `image-${Date.now()}${ext}`)

  const fileStream = fs.createWriteStream(tempFilePath)

  await pipeline(response.body!, fileStream)

  return tempFilePath
}
