import fs from 'fs'
import path from 'path'
import reactServer from 'react-dom/server'

console.log('Version', reactServer.version)

import { Context, type Plugin } from '../../index'
import { Readable } from 'stream'
import { UseHydrateCacheOptions } from '@gqty/react'
import { PylonPageLoader } from '../../../page-loader'

export interface PageData { }

export type PageProps = {
  data: PageData
  params: Record<string, string>
  searchParams: Record<string, string>
  path: string
}

const Document: React.FC<{
  pagePath: string
  pageProps: Omit<PageProps, 'data'>
  cacheSnapshot?: UseHydrateCacheOptions['cacheSnapshot']
  children: React.ReactNode
}> = props => {
  return (
    <html>
      <head>
        <script id="__PYLON_DATA__" type="application/json">
            {JSON.stringify({
              pageProps: props.pageProps,
              cacheSnapshot: props.cacheSnapshot
            })}
        </script>
        <script type="module" defer src={`/static/${props.pagePath}`}></script>
        <link rel="stylesheet" href="/static/output.css" />
      </head>
      <body>
        <div id="root">{props.children}</div>
      </body>
    </html>
  )
}


export const onApp: Plugin["onApp"] = app => {


    const pagesFilePath = path.resolve(process.cwd(), '.pylon', 'pages.json')

    // Read the pages file
    const pages = JSON.parse(fs.readFileSync(pagesFilePath, 'utf-8')) as {
      filePath: string
      routePath: string
    }[]

    // Generate the routes
    for (const page of pages) {
      const { filePath, routePath } = page

      app.get(routePath, async c => {
        const client = await import(`${process.cwd()}/.pylon/client`)

       
        const relativePath = path.relative(
          path.resolve(process.cwd(), '.pylon'),
          filePath
        )

        const { default: Page2 } = await import(
          `${process.cwd()}/${relativePath.replace(/\.js$/, '.tsx')}`
        )

        const pageProps = {
          params: c.req.param(),
          searchParams: c.req.query(),
          path: c.req.path,
        }

        const { cacheSnapshot } = await client.prepareReactRender(
          <Document pagePath={relativePath} pageProps={pageProps}>
            <PylonPageLoader
              client={client}
              Page={Page2}
              cacheSnapshot={undefined}
              pageProps={pageProps}
            />
          </Document>
        )

        console.log('cacheSnapshot', cacheSnapshot)

        return c.body(
          await reactServer.renderToReadableStream(
            <Document pagePath={relativePath} cacheSnapshot={cacheSnapshot} pageProps={pageProps}>
              <PylonPageLoader
                client={client}
                Page={Page2}
                cacheSnapshot={cacheSnapshot}
                pageProps={pageProps}
              />
            </Document>
          )
        )
      })
    }

    app.get('/static/pages/*', async c => {
      const filePath = path.resolve(
        process.cwd(),
        '.pylon',
        'pages',
        c.req.path.replace('/static/pages/', '')
      )

      console.log('Static file', filePath)

      if (!fs.existsSync(filePath)) {
        throw new Error('File not found')
      }

      c.res.headers.set('Content-Type', 'text/javascript')

      const stream = fs.createReadStream(filePath)

      const a = Readable.toWeb(stream) as ReadableStream

      return c.body(a)
    })

    app.get('/static/output.css', async c => {
      const filePath = path.resolve(process.cwd(), '.pylon', 'output.css')

      console.log('Static file', filePath)

      if (!fs.existsSync(filePath as string)) {
        throw new Error('File not found')
      }

      c.res.headers.set('Content-Type', 'text/css')

      const stream = fs.createReadStream(filePath)

      const a = Readable.toWeb(stream) as ReadableStream

      return c.body(a)
    })
}
