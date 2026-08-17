import path from 'path'
import type {Plugin as VitePlugin} from 'rolldown-vite'

/**
 * Vite dev plugins for the pages plane (rfcs/DEV_SERVER.md Step 3b).
 *
 * The prod page build (`rolldown-plugins.ts`) appends the hydration bootstrap to
 * `.pylon/app.tsx` in a rolldown `load` hook, producing a dedicated CLIENT bundle
 * separate from the SSR bundle. Under Vite there is ONE `app.tsx` served two ways —
 * `ssrLoadModule` for SSR (clean routes) and a browser `import` for the client — so we
 * append the hydration code ONLY on the client transform (`!ssr`). SSR gets the
 * untouched routes module; the browser gets the hydrating entry. No SSE block: Vite's
 * HMR ws + React Fast Refresh replace the Tier-0 live-reload.
 */
export function injectHydrationVite(
  version: string,
  appTsxAbs: string
): VitePlugin {
  const resolved = path.resolve(appTsxAbs)
  return {
    name: 'pylon-inject-hydration-vite',
    // Run before Vite's oxc transpile so the appended JSX is transpiled with the rest.
    enforce: 'pre',
    transform(code, id, options) {
      // SSR pass → leave app.tsx as a clean routes module (no `document`/hydrateRoot).
      if (options?.ssr) return null
      if (path.resolve(id.split('?')[0]) !== resolved) return null

      // `__PYLON_ROUTER_INTERNALS_DO_NOT_USE` / `__PYLON_INTERNALS_DO_NOT_USE` and
      // `routes` (the default export) are already in app.tsx's top scope (see
      // app-utils.ts `generateRouteFileContent`) — reference them, don't re-import.
      const hydration = `
        import {hydrateRoot} from 'react-dom/client'
        import * as client from './client'
        import React, {startTransition} from 'react'

        // @ts-ignore
        window.__PYLON_VERSION__ = ${JSON.stringify(version)}

        async function __pylonHydrate() {
          const lazyMatches = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.matchRoutes(routes, window.location)?.filter(
            (m) => m.route.lazy
          );
          if (lazyMatches && lazyMatches.length > 0) {
            await Promise.all(
              lazyMatches.map(async (m) => {
                const routeModule = await m.route.lazy();
                Object.assign(m.route, { ...routeModule, lazy: undefined });
              })
            );
          }

          const payload = (window).__pylonStaticData?.cache
          if (payload) {
            const coreClient = (client).client || client
            if (coreClient && typeof coreClient.hydrate === 'function') {
              coreClient.hydrate(payload)
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
              </__PYLON_INTERNALS_DO_NOT_USE.DataClientProvider>,
              {
                onUncaughtError: (error, errorInfo) => {
                  console.warn('Uncaught error', error, errorInfo.componentStack);
                },
              }
            )
          })
        }

        __pylonHydrate()
      `
      return {code: code + '\n' + hydration, map: null}
    }
  }
}
