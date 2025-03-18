import {Plugin} from 'esbuild'
import path from 'path'
import fs from 'fs/promises'

export const injectAppHydrationPlugin: Plugin = {
  name: 'inject-hydration',
  setup(build) {
    build.onLoad({filter: /.*/, namespace: 'file'}, async args => {
      // check if the file is the app.tsx file
      if (args.path === path.resolve(process.cwd(), '.pylon', 'app.tsx')) {
        let contents = await fs.readFile(args.path, 'utf-8')

        const clientPath = path.resolve(process.cwd(), '.pylon/client')

        const pathToClient = path.relative(path.dirname(args.path), clientPath)

        contents += `
          import {hydrateRoot} from 'react-dom/client'
          import * as client from './${pathToClient}'
          import { __PYLON_ROUTER_INTERNALS_DO_NOT_USE, DevOverlay, onCaughtErrorProd, onRecoverableErrorProd, onUncaughtErrorProd } from '@getcronit/pylon/pages';
          const {BrowserRouter, useParams, useSearchParam, useLocation} = __PYLON_ROUTER_INTERNALS_DO_NOT_USE
          import React, {useMemo} from 'react'

          const pylonData = window.__PYLON_DATA__

          const AppLoader = (props: {
            client: any
            pylonData: {
              pageProps: Omit<PageProps, 'data'>
              cacheSnapshot?: any
            }
            App: React.FC<{
              pageProps: PageProps
            }>
            Router: React.FC<any>
            routerProps: any
          }) => {
            props.client.useHydrateCache({cacheSnapshot: props.pylonData.cacheSnapshot})

            // Inject the data from the client into the pageProps if it differs from the server
            // This is necessary for client-side navigation to work correctly


            const params = useParams();
            const [searchParams] = useSearchParams();
            const location = useLocation();

            if (params && JSON.stringify(params) !== JSON.stringify(props.pylonData.pageProps.params)) {
              props.pylonData.pageProps.params = params;
            }

            if (searchParams && JSON.stringify(searchParams) !== JSON.stringify(props.pylonData.pageProps.searchParams)) {
              props.pylonData.pageProps.searchParams = searchParams;
            }

            if (location.pathname && location.pathname !== props.pylonData.pageProps.location) {
              props.pylonData.pageProps.location = location.pathname;
            }

                   
            const data = props.client.useQuery()
            const page = useMemo(() => {
              const page = (
                <props.App
                  pageProps={{
                    ...props.pylonData.pageProps,
                    data
                  }}
                />
              )
          
              return page
            }, [props])
          
            return <props.Router {...props.routerProps}>{page}</props.Router>
          }

        
          

          hydrateRoot(
          document,
            <AppLoader Router={BrowserRouter} client={client} pylonData={pylonData} App={App} />, {
                  onCaughtError: onCaughtErrorProd,
      onRecoverableError: onRecoverableErrorProd,
      onUncaughtError: onUncaughtErrorProd,
            }
          )
          `

        return {
          loader: 'tsx',
          contents
        }
      }
    })
  }
}
