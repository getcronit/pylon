import fs from 'fs'
import path from 'path'
import reactServer from 'react-dom/server'

import { UseHydrateCacheOptions } from '@gqty/react'
import { Readable } from 'stream'
import { AppLoader, pageLoader, PylonPageLoader } from '../../../page-loader'
import { type Plugin } from '../../index'
import { PageRoute } from './on-build'
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


export const onApp: Plugin["onApp"] = app => {


  const pagesFilePath = path.resolve(process.cwd(), '.pylon', 'pages.json')

  let pageRoutes: PageRoute[] = []
  try {
    pageRoutes = JSON.parse(fs.readFileSync(pagesFilePath, 'utf-8'))
  } catch (error) {
    console.error('Error reading pages.json', error)
  }

  console.log('pages', pageRoutes)

  app.use(trimTrailingSlash())

 


  app.on("GET", pageRoutes.map(pageRoute => pageRoute.slug), async c => {

    const { default: App } = await import(`${process.cwd()}/.pylon/pages/app.js`)
    const client = await import(`${process.cwd()}/.pylon/client`)


    const pageProps = {
      params: c.req.param(),
      searchParams: c.req.query(),
      path: c.req.path,
    }


    let cacheSnapshot: UseHydrateCacheOptions | undefined = undefined

    console.log('pageProps', pageProps)


    const prepared = await client.prepareReactRender(
      <AppLoader Router={StaticRouter} routerProps={{
        location: c.req.path
      }} App={App} client={client} pylonData={{
        pageProps: pageProps,
        cacheSnapshot: undefined
      }} />
    )

    cacheSnapshot = prepared.cacheSnapshot

    console.log('cacheSnapshot', cacheSnapshot)

    return c.body(
      await reactServer.renderToReadableStream(<AppLoader Router={StaticRouter} routerProps={{
        location: c.req.path
      }} App={App} client={client} pylonData={{
        pageProps: pageProps,
        cacheSnapshot: prepared.cacheSnapshot
      }} />, {
        bootstrapModules: ["/public/app.js"],
        bootstrapScriptContent: `window.__PYLON_DATA__ = ${JSON.stringify({
          pageProps: pageProps,
          cacheSnapshot: cacheSnapshot,
        })}`
      }
      )
    )
  })

  // Generate the routes
  // for (const pageRoute of pageRoutes) {

  //   app.get(pageRoute.slug, async c => {
  //     const client = await import(`${process.cwd()}/.pylon/client`)


  //     const relativeBundlePath = path.relative(path.join(process.cwd(), "pages"), pageRoute.pagePath);
  //     const clientBundlePaths = {
  //       js: `/public/${relativeBundlePath.replace('.tsx', '.js')}`,
  //       css: `/public/${relativeBundlePath.replace('.tsx', '.css')}`,
  //     }

  //     console.log(pageRoute.pagePath, relativeBundlePath)

  //     const serverBundlePath = path.resolve(
  //       process.cwd(),
  //       '.pylon',
  //       'pages',
  //       relativeBundlePath.replace('.tsx', '.js')
  //     )


  //     let time = Date.now()

  //     console.time('Page Import Time')
  //     const { default: Page2 } = await import(
  //       serverBundlePath
  //     )
  //     console.timeEnd('Page Import Time')

  //     const pageProps = {
  //       params: c.req.param(),
  //       searchParams: c.req.query(),
  //       path: c.req.path,
  //     }

  //     let cacheSnapshot: UseHydrateCacheOptions | undefined = undefined






  //     console.time('Prepare React Render Time')
  //     const prepeare = await client.prepareReactRender(
  //       await pageLoader({
  //         cacheSnapshot,
  //         client,
  //         clientBundlePaths,
  //         Page: Page2,
  //         pageProps,
  //       })
  //     )
  //     console.timeEnd('Prepare React Render Time')

  //     cacheSnapshot = prepeare.cacheSnapshot

  //     return c.body(
  //       await reactServer.renderToReadableStream(
  //         await pageLoader({
  //           cacheSnapshot,
  //           client,
  //           clientBundlePaths,
  //           Page: Page2,
  //           pageProps,
  //         })
  //       )
  //     )
  //   })
  // }

  app.get('/public/*', async c => {
    const filePath = path.resolve(
      process.cwd(),
      '.pylon',
      'public',
      c.req.path.replace('/public/', '')
    )

    if (!fs.existsSync(filePath)) {
      throw new Error('File not found')
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
}
