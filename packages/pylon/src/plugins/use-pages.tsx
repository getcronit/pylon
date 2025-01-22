import fs from 'fs'
import path from 'path'
import { renderToString, renderToReadableStream, version } from 'react-dom/server'

console.log('Version', version)

import { type Plugin } from '../index'
import { Readable } from 'stream'
import { UseHydrateCacheOptions } from '@gqty/react'
import { PylonPageLoader } from '../../page-loader'

export interface PageData { }

export type PageProps = {
  data: PageData
}

const Document: React.FC<{
  pagePath: string
  cacheSnapshot?: UseHydrateCacheOptions['cacheSnapshot']
  children: React.ReactNode
}> = props => {
  return (
    <html>
      <head>
        <script>
          {'window.__pylon_cache_snapshot = ' +
            JSON.stringify(props.cacheSnapshot)}
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

// export const PylonPageLoader: React.FC<{
//   client: any
//   pagePath: string
//   Element: React.FC<PageProps>
//   cacheSnapshot?: UseHydrateCacheOptions['cacheSnapshot']
// }> = props => {

//   props.client.useHydrateCache({ cacheSnapshot: props.cacheSnapshot })

//   const data = props.client.useQuery()

//   return (
//     <html>
//       <head>
//         <script
//           type="module"
//           defer
//           src={`/static/${props.pagePath}`}></script>
//       </head>
//       <body>
//         <div id="root">
//           <props.Element data={data} />
//         </div>
//       </body>
//     </html>
//   )
// }

export function usePages(args: {}): Plugin {
  return {
    app: app => {
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

          // const PageDataLoader = (props: {
          //   Element: React.FC<PageProps>
          //   cacheSnapshot?: UseHydrateCacheOptions['cacheSnapshot']
          // }) => {
          //   client.useHydrateCache({ cacheSnapshot: props.cacheSnapshot })

          //   const data = client.useQuery()

          //   return (
          //     <html>
          //       <head>
          //         <script
          //           type="module"
          //           defer
          //           src={`/static/${relativePath}`}></script>
          //       </head>
          //       <body>
          //         <div id="root">
          //           <props.Element data={data} />
          //         </div>
          //       </body>
          //     </html>
          //   )
          // }

          const relativePath = path.relative(
            path.resolve(process.cwd(), '.pylon'),
            filePath
          )

          const { default: Page2 } = await import(
            `${process.cwd()}/${relativePath.replace(/\.js$/, '.tsx')}`
          )

          const { cacheSnapshot } = await client.prepareReactRender(
            <Document pagePath={relativePath}>
              <PylonPageLoader
                client={client}
                Page={Page2}
                cacheSnapshot={undefined}
              />
            </Document>
          )

          console.log('cacheSnapshot', cacheSnapshot)

          return c.body(
            await renderToReadableStream(
              <Document pagePath={relativePath} cacheSnapshot={cacheSnapshot}>
                <PylonPageLoader
                  client={client}
                  Page={Page2}
                  cacheSnapshot={cacheSnapshot}
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
  }
}
