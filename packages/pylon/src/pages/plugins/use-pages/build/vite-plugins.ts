import path from 'path'
import type {Plugin as VitePlugin} from 'rolldown-vite'

import {emitDevImageUrl, IMAGE_FILTER_RE} from './rolldown-plugins'

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
/**
 * Dev image parity: resolve a module-imported image (`import img from './x.png'`) to the
 * SAME `{url}` the rolldown dev SSR emits (`imagePlugin({dev:true})` → `emitDevImageUrl`),
 * instead of Vite's default asset URL. Without this the SSR and client would render a
 * different `<img src>` for `<Image src={import}>` → hydration mismatch. Build-time image
 * optimization (blur/dimensions) stays a prod-only feature. `enforce:'pre'` so it wins
 * over Vite's built-in asset handling.
 */
export function pylonImageVite(mediaDir: string, publicPath: string): VitePlugin {
  return {
    name: 'pylon-image-vite',
    enforce: 'pre',
    async load(id) {
      const clean = id.split('?')[0]
      if (!IMAGE_FILTER_RE.test(clean)) return null
      const url = await emitDevImageUrl(clean, mediaDir, publicPath)
      return `export default ${JSON.stringify({url})}`
    }
  }
}

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

        // DEV navigation/reload tracer: patch every full-page reload/navigation so a reload
        // LOOP reveals its caller. Logs the stack on rapid repeats and SUPPRESSES after a burst
        // so the loop breaks and the stacks stay visible. Dev-only (this bootstrap is never in
        // the prod build). Clear \`sessionStorage.__pylon_nav\` (or hard-reload) to reset.
        try {
          var __pylonGuard = function (label, arg, proceed) {
            var now = Date.now();
            var hist = [];
            try { hist = JSON.parse(sessionStorage.getItem('__pylon_nav') || '[]'); } catch (e) {}
            hist = hist.filter(function (t) { return now - t < 3000; });
            hist.push(now);
            try { sessionStorage.setItem('__pylon_nav', JSON.stringify(hist)); } catch (e) {}
            if (hist.length > 1) {
              console.error('[pylon dev] rapid reload #' + hist.length + ' — ' + label, arg == null ? '' : arg, '\\ncaller stack:\\n' + ((new Error()).stack || ''));
            }
            if (hist.length > 3) {
              console.error('%c[pylon dev] RELOAD LOOP suppressed — fix the caller shown above, then hard-reload.', 'color:red;font-weight:bold;font-size:13px');
              return;
            }
            proceed();
          };
          var __R = Location.prototype.reload;
          Location.prototype.reload = function () { var self = this, a = arguments; __pylonGuard('location.reload()', undefined, function () { __R.apply(self, a); }); };
          var __A = Location.prototype.assign;
          Location.prototype.assign = function (u) { var self = this; __pylonGuard('location.assign()', u, function () { __A.call(self, u); }); };
          var __RP = Location.prototype.replace;
          Location.prototype.replace = function (u) { var self = this; __pylonGuard('location.replace()', u, function () { __RP.call(self, u); }); };
          var __hd = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
          if (__hd && __hd.set) {
            Object.defineProperty(location, 'href', {
              configurable: true,
              get: function () { return __hd.get.call(location); },
              set: function (v) { __pylonGuard('location.href =', v, function () { __hd.set.call(location, v); }); }
            });
          }
        } catch (e) { console.warn('[pylon dev] nav tracer setup failed', e); }

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
