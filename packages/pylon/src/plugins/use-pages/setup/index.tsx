import fs from 'fs'
import path from 'path'
import reactServer from 'react-dom/server'

import { UseHydrateCacheOptions } from '@gqty/react'
import { Readable } from 'stream'
import { AppLoader } from './app-loader'
import { getEnv, type Plugin } from '../../../index'
import { cloneElement, createElement } from 'react'
import { trimTrailingSlash } from 'hono/trailing-slash'
import { StaticRouter } from 'react-router'

export interface PageData { }

export type PageProps = {
  data: PageData
  params: Record<string, string>
  searchParams: Record<string, string>
  path: string
}

const disableCacheMiddleware: MiddlewareHandler = async (c, next) => {
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

  app.use(trimTrailingSlash())

  let App: any = undefined
  let client: any = undefined

  app.on(
    'GET',
    pageRoutes.map(pageRoute => pageRoute.slug),
    disableCacheMiddleware,
    async c => {
      if (!App) {
        const module = await import(
          `${process.cwd()}/.pylon/__pylon/pages/app.js`
        )

        App = module.default
      }

      if (!client) {
        client = await import(`${process.cwd()}/.pylon/client`)
      }

      const pageProps = {
        params: c.req.param(),
        searchParams: c.req.query(),
        path: c.req.path
      }

      let cacheSnapshot: UseHydrateCacheOptions | undefined = undefined

      const prepared = await client.prepareReactRender(
        <AppLoader
          Router={StaticRouter}
          routerProps={{
            location: c.req.path
          }}
          App={App}
          client={client}
          pylonData={{
            pageProps: pageProps,
            cacheSnapshot: undefined
          }}
        />
      )

      cacheSnapshot = prepared.cacheSnapshot

      const stream = await reactServer.renderToReadableStream(
        <AppLoader
          Router={StaticRouter}
          routerProps={{
            location: c.req.path
          }}
          App={App}
          client={client}
          pylonData={{
            pageProps: pageProps,
            cacheSnapshot: prepared.cacheSnapshot
          }}
        />,
        {
          bootstrapModules: ['/__pylon/static/app.js'],
          bootstrapScriptContent: `window.__PYLON_DATA__ = ${JSON.stringify({
            pageProps: pageProps,
            cacheSnapshot: cacheSnapshot
          })}`
        }
      )

      return c.body(stream)
    }
  )

  const publicFilesPath = path.resolve(process.cwd(), '.pylon', '__pylon', 'public')
  let publicFiles: string[] = []

  try {
    publicFiles = fs.readdirSync(publicFilesPath)
  } catch (error) {
    console.error('Error reading public files', error)
  }

  console.log('publicFiles', publicFiles)

  app.on('GET',
    publicFiles.map(file => `/${file}`), disableCacheMiddleware, async c => {
      const publicFilePath = path.resolve(
        process.cwd(),
        '.pylon',
        '__pylon',
        'public',
        c.req.path.replace('/', '')
      )

      console.log('publicFilePath', publicFilePath)

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
        } else if (publicFilePath.endsWith('.jpg') || publicFilePath.endsWith('.jpeg')) {
          c.res.headers.set('Content-Type', 'image/jpeg')
        } else if (publicFilePath.endsWith('.gif')) {
          c.res.headers.set('Content-Type', 'image/gif')
        } else if (publicFilePath.endsWith('.svg')) {
          c.res.headers.set('Content-Type', 'image/svg+xml')
        } else if (publicFilePath.endsWith('.ico')) {
          c.res.headers.set('Content-Type', 'image/x-icon')
        }

        const stream = fs.createReadStream(publicFilePath)

        const a = Readable.toWeb(stream) as ReadableStream

        return c.body(a)

      } catch {
        return c.status(404)
      }
    })


  app.get('/__pylon/static/*', disableCacheMiddleware, async c => {
    const filePath = path.resolve(
      process.cwd(),
      '.pylon',
      '__pylon',
      'static',
      c.req.path.replace('/__pylon/static/', '')
    )

    if (!fs.existsSync(filePath)) {
      return c.status(404)
    }

    if (filePath.endsWith('.js')) {
      c.res.headers.set('Content-Type', 'text/javascript')
    } else if (filePath.endsWith('.css')) {
      c.res.headers.set('Content-Type', 'text/css')
    } else if (filePath.endsWith('.html')) {
      c.res.headers.set('Content-Type', 'text/html')
    } else if (filePath.endsWith('.json')) {
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

    const a = Readable.toWeb(stream) as ReadableStream

    return c.body(a)
  })

  // Image optimization route
  app.get('/__pylon/image', async c => {
    console.log('image optimization route')
    try {
      const { src, w, h, q = '75', format = 'webp' } = c.req.query()

      const queryStringHash = createHash('sha256')
        .update(JSON.stringify(c.req.query()))
        .digest('hex')

      if (!src) {
        return c.json({ error: 'Missing parameters.' }, 400)
      }

      let imagePath = path.join(process.cwd(), '.pylon', src)

      if (src.startsWith('http://') || src.startsWith('https://')) {
        imagePath = await downloadImage(src)
      }

      // Check if the image exists asynchronously
      try {
        console.log('imagePath', imagePath)
        await fs.promises.access(imagePath)
      } catch {
        return c.json({ error: 'Image not found' }, 404)
      }

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
      const { width: finalWidth, height: finalHeight } = calculateDimensions(
        metadata.width,
        metadata.height,
        w ? parseInt(w) : undefined,
        h ? parseInt(h) : undefined
      )

      // Check cache first
      const cachePath = path.join(IMAGE_CACHE_DIR, queryStringHash)

      let imageFormat = format.toLowerCase()

      if (!isSupportedFormat(imageFormat)) {
        throw new Error('Unsupported image format')
      }

      // Serve cached image if it exists
      // try {
      //   await fs.promises.access(cachePath);

      //   const stream = fs.createReadStream(cachePath)

      //   c.res.headers.set('Content-Type', getContentType(imageFormat));

      //   return c.body(Readable.toWeb(stream) as ReadableStream)
      // } catch {
      //   // Proceed to optimize and cache the image if it doesn't exist
      // }

      const quality = parseInt(q)

      console.log('quality', quality)

      // Optimize the image using sharp
      const image = await sharp(imagePath)
        .resize(finalWidth, finalHeight)
        .toFormat(imageFormat, {
          quality
        })
        .toFile(cachePath)

      console.log('image', image)

      c.res.headers.set('Content-Type', getContentType(image.format))

      // Serve the optimized image
      return c.body(
        Readable.toWeb(fs.createReadStream(cachePath)) as ReadableStream
      )
    } catch (error) {
      console.error('Error processing the image:', error)
      return c.json({ error: 'Error processing the image' }, 500)
    }
  })
}

import sharp, { FormatEnum } from 'sharp'
import { createHash } from 'crypto'

// Cache directory
const IMAGE_CACHE_DIR = path.join(process.cwd(), '.cache/__pylon/images')

// Ensure the cache directory exists
fs.promises.mkdir(IMAGE_CACHE_DIR, { recursive: true })

// Helper function to generate the cached image path
const getCachedImagePath = (
  src: string,
  width: number,
  height: number,
  format: keyof FormatEnum
) => {
  const fileName = `${path.basename(
    src,
    path.extname(src)
  )}-${width}x${height}.${format}`
  return path.join(IMAGE_CACHE_DIR, fileName)
}

// Utility function to calculate missing dimension based on aspect ratio
const calculateDimensions = (
  originalWidth: number,
  originalHeight: number,
  width?: number,
  height?: number
) => {
  if (!width && !height) {
    return { width: originalWidth, height: originalHeight }
  }
  if (width && !height) {
    // Calculate height based on the aspect ratio
    height = Math.round((width * originalHeight) / originalWidth)
  } else if (height && !width) {
    // Calculate width based on the aspect ratio
    width = Math.round((height * originalWidth) / originalHeight)
  }
  return { width, height }
}

function isSupportedFormat(format: string): format is keyof FormatEnum {
  const supportedFormats = sharp.format
  return Object.keys(supportedFormats).includes(format)
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

import { tmpdir } from 'os'
import { promisify } from 'util'
import { pipeline } from 'stream/promises'
import { PageRoute } from '../build/app-utils'
import { MiddlewareHandler } from 'hono'

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
