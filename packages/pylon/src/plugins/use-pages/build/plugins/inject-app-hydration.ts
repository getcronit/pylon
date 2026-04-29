import {Plugin} from 'esbuild'
import fs from 'fs/promises'
import path from 'path'

export const injectAppHydrationPlugin = (version: string): Plugin => ({
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
          import React, {startTransition} from 'react'
          import * as Sentry from '@sentry/react'

          // @ts-ignore
          window.__PYLON_VERSION__ = "${version}"

          async function hydrate() {
            // Determine if any of the initial routes are lazy
            const lazyMatches = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.matchRoutes(routes, window.location)?.filter(
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

            const payload = (window as any).__pylonStaticData
            if (payload?.cache) {
              const coreClient = (client as any).client || client
              if (coreClient && coreClient.cache) {
                console.log('Hydrating cache with payload', payload.cache, coreClient)
                coreClient.hydrateCache({cacheSnapshot: payload.cache, shouldRefetch: false})
              }
            }

            // @ts-ignore
            const router = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.createBrowserRouter(routes)

            // @ts-ignore
            window.__PYLON_NAVIGATE__ = router.navigate

            startTransition(() => {
              hydrateRoot(
                document,
                  <__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider client={client}>
                    <__PYLON_ROUTER_INTERNALS_DO_NOT_USE.RouterProvider router={router} />
                  </__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider>
              , {
                // Callback called when an error is thrown and not caught by an ErrorBoundary.
                onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
                  console.warn('Uncaught error', error, errorInfo.componentStack);
                }),
                // Callback called when React catches an error in an ErrorBoundary.
                onCaughtError: Sentry.reactErrorHandler(),
                // Callback called when React automatically recovers from errors.
                onRecoverableError: Sentry.reactErrorHandler(),
              })
            })
         }

         hydrate()


          `

        return {
          loader: 'tsx',
          contents
        }
      }
    })
  }
})
