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
          import { __PYLON_ROUTER_INTERNALS_DO_NOT_USE, __PYLON_INTERNALS_DO_NOT_USE, DevOverlay, onCaughtErrorProd, onRecoverableErrorProd, onUncaughtErrorProd } from '@getcronit/pylon/pages';
          const {createBrowserRouter, RouterProvider, matchRoutes} = __PYLON_ROUTER_INTERNALS_DO_NOT_USE
          const {DataClientProvider} = __PYLON_INTERNALS_DO_NOT_USE
          import React, {useMemo} from 'react'

          hydrate()

          async function hydrate() {
            // Determine if any of the initial routes are lazy
            const lazyMatches = matchRoutes(routes, window.location)?.filter(
              (m) => m.route.lazy
            );

            // Load the lazy matches and update the routes before creating your router
            // so we can hydrate the SSR-rendered content synchronously
            if (lazyMatches && lazyMatches?.length > 0) {
              await Promise.all(
                lazyMatches.map(async (m) => {
                  const routeModule = await m.route.lazy!();
                  Object.assign(m.route, { ...routeModule, lazy: undefined });
                })
              );
            }

            const router = createBrowserRouter(routes)

            hydrateRoot(
              document,
              <DataClientProvider client={client}>
                  <RouterProvider router={router} />
              </DataClientProvider>
            )
          }


          `

        return {
          loader: 'tsx',
          contents
        }
      }
    })
  }
}
