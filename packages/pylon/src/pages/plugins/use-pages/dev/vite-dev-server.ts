/**
 * usePages DEV server — CLIENT-only Vite (rfcs/DEV_SERVER.md Step 3b, "clean split").
 *
 * Vite does exactly ONE job: serve the browser's client modules with React Fast Refresh.
 * It fronts the port in middleware mode and serves client assets + `/@vite` + `/@react-refresh`
 * + the HMR ws; ANY request it doesn't own (`/`, `/graphql`, the SSR catch-all) falls
 * through to the booted Pylon app (`app.fetch`).
 *
 * SSR, serving and CSS stay on the rolldown+Hono path (Step 1) — Vite never runs
 * `ssrLoadModule`, never touches `<head>` or the manifest. The only things it adds to a
 * page are the `@vite/client` + react-refresh preamble (via `transformIndexHtml`) and the
 * client entry it serves. SSR renders the rolldown routes; the client hydrates the SAME
 * `app.tsx` source Vite serves → structure matches, hydration is clean, and the rolldown
 * build's precedence'd CSS `<link>`s mean no FOUC. Dev-only; never in the prod artifact.
 *
 * `setup/index.tsx` reads the bridge (via globalThis) for two things only: the client
 * bootstrap URL, and `transformHtml` to inject the Vite dev scripts.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import {
  patchViteOverlayMessages,
  sanitizeViteHttpErrors,
  wrapViteLogger
} from '../../../../cli/dev/vite-messages.js'
import {useDataStaticAnalyzerVite} from '../build/plugins/use-data-static-analyzer/index'
import {injectHydrationVite, pylonImageVite} from '../build/vite-plugins'

export interface PagesDevBridge {
  /** Inject `@vite/client` + the React-Refresh preamble into a rendered HTML string. */
  transformHtml(url: string, html: string): Promise<string>
  /** The browser entry Vite serves (app.tsx + hydration bootstrap) — bootstrapModules. */
  clientEntry: string
  /** Full-reload the browser over Vite's HMR ws — used on a `src`/resolver edit so the
   *  page re-fetches (component edits are handled in place by Fast Refresh). */
  reloadBrowser(): void
}

export interface PagesDevServerOptions {
  root: string
  appTsxAbs: string
  version: string
  /**
   * Compile `@inContext(locale: $__locale)` into client documents — mirrors what the
   * rolldown build does for production.
   *
   * Without it the two halves of dev disagree: the SSR bundle (built by the rolldown
   * analyzer) carries the directive while the client bundle does not, so after hydration a
   * refetch sends a DIFFERENT document — missing the hydration cache entry and losing the
   * locale. Production would be fine and only dev would be wrong, which is the worst place
   * for a difference to live.
   */
  inContext?: boolean
}

export interface PagesDevServer {
  /** Front the port: Vite middlewares → app.fetch fallback. */
  frontPort(
    fetch: (req: Request) => Response | Promise<Response>,
    port: number
  ): Promise<void>
  close(): Promise<void>
}

/**
 * Stand up the client-only Vite dev server + install the `__PYLON_PAGES_DEV__` bridge.
 * Call AFTER the app boots (`server.mjs`) — SSR uses the rolldown path (Step 1), so the
 * bridge only needs to exist before the first request, which `frontPort()` gates.
 */
export async function createPagesDevServer(
  options: PagesDevServerOptions
): Promise<PagesDevServer> {
  // Dev-only heavy deps — non-literal specifiers keep them out of the static graph /
  // prod trace (mirrors the bundler's `tsx/esm/api` pattern).
  const viteMod = 'rolldown-vite'
  // The unified React plugin (the experimental `-oxc` fork folded back into it); under
  // rolldown-vite it uses the oxc transform automatically.
  const reactMod = '@vitejs/plugin-react'
  const tsPathsMod = 'vite-tsconfig-paths'
  const nodeServerMod = '@hono/node-server'
  const {createServer, createLogger} = (await import(viteMod)) as {
    createServer: (c: any) => Promise<any>
    createLogger: (level?: string) => any
  }
  const react = ((await import(reactMod)) as any).default
  // Resolve the app's tsconfig `paths` (e.g. `@/*`) — Vite doesn't apply them natively.
  const tsconfigPaths = ((await import(tsPathsMod)) as any).default
  const {getRequestListener} = (await import(nodeServerMod)) as {
    getRequestListener: (
      fetch: (req: Request) => Response | Promise<Response>
    ) => (req: any, res: any) => void
  }

  // Vite is a library here — the app has no `vite.config.ts`, so its diagnostics get
  // restated in Pylon's vocabulary (and its internal-only noise dropped) before they reach
  // the terminal. See `cli/dev/vite-messages.ts`.
  const logger = wrapViteLogger(createLogger('warn'))

  // Own the app's http.Server up front so Vite can run HMR OVER IT (same origin + port)
  // rather than opening its own ws server on Vite's fixed default port 24678. Two pylon dev
  // servers would otherwise fight over that one hardcoded port: the loser can't bind it, and
  // its browser silently connects to the WINNER's HMR socket — cross-wiring updates between
  // apps (stray reloads, "hot update for a module I don't have"). Sharing the app port means
  // each dev server has its own HMR channel and can never collide. `server`/`honoListener`
  // are assigned just below / in `frontPort`; the handler only runs once the server is
  // listening, by which point both are set.
  let server: any
  let honoListener: ((req: any, res: any) => void) | null = null
  const httpServer = http.createServer((req, res) => {
    // Vite writes its 403/500 pages straight to the socket — rewrite them on the way out.
    sanitizeViteHttpErrors(res)
    server.middlewares(req, res, () => honoListener?.(req, res))
  })

  server = await createServer({
    root: options.root,
    configFile: false,
    customLogger: logger,
    appType: 'custom',
    // Distinct dep-cache dir from the server-plane module runner (the other Vite in this
    // worker) so they don't clobber each other's optimize hashes.
    cacheDir: path.join(options.root, 'node_modules', '.vite-pylon-pages'),
    // Middleware mode: Vite serves client assets and runs React Fast Refresh, but binds no
    // port itself — `hmr.server` points the HMR websocket at our shared http.Server (above),
    // so it upgrades over the app port instead of Vite's fixed 24678 (see the note there).
    server: {middlewareMode: true, hmr: {server: httpServer}},
    // Single instance of the framework/react across the client graph — otherwise the
    // workspace `@getcronit/pylon/pages` (treated as source) can load twice, giving two
    // React contexts → "useDataClient must be used within a DataClientProvider".
    resolve: {dedupe: ['@getcronit/pylon', 'react', 'react-dom', 'react-router']},
    optimizeDeps: {
      // Crawl the app graph up front so Vite pre-bundles all deps in one pass instead of
      // discovering them lazily on navigation (which re-optimizes → "Outdated Optimize Dep").
      entries: [
        path.relative(options.root, options.appTsxAbs).split(path.sep).join('/'),
        'pages/**/*.{ts,tsx,js,jsx}'
      ],
      // The dep scanner only crawls the app's `pages/**`, so it can't see two categories of
      // deps that still reach the browser:
      //  1. the React runtime `injectHydrationVite` appends at transform time (never in the
      //     scanned source), and
      //  2. everything `@getcronit/pylon/pages`' own client components import (react-router,
      //     the ui primitives, mitt) — we `dedupe` the framework and treat it as source, so
      //     Vite never crawls its node_modules to discover them.
      // Rather than hand-copy that transitive list here (it drifts every time the framework's
      // client runtime gains a dep, and pnpm doesn't hoist it to the app root anyway), force
      // the framework's client barrel and let the optimizer follow ITS imports from the
      // framework's own location — self-maintaining. The injected React runtime entries can't
      // be reached that way, so name them explicitly.
      include: [
        '@getcronit/pylon/pages',
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime'
      ]
    },
    plugins: [
      tsconfigPaths({root: options.root, ignoreConfigErrors: true}),
      react(),
      // `pre`: rewrite useData → compiled docs BEFORE Vite's oxc transpile.
      // Hand the analyzer the app's tsconfig so its ts-morph project resolves the
      // app's path aliases (`@/*`) to REAL files. Without it every non-relative
      // import falls to the analyzer's `*`→dummy catch-all, so a page that imports
      // its components + the connection node type via `@/…` (the lokalis convention)
      // leaves the project too thin for the connection pass to trace inline
      // node-field reads (`e.actorLabel` in a `DataGridColumn<AuditEvent>` cell) — the
      // selection collapses to `{ id }`. The prod rolldown build sidesteps this by
      // feeding the WHOLE module graph through the analyzer (every file is loaded by
      // absolute path); dev transforms modules on-demand, so it needs the aliases to
      // pull the same sources in. Guarded on existence so alias-less apps are unaffected.
      useDataStaticAnalyzerVite({
        inContext: options.inContext,
        entryPaths: [options.appTsxAbs],
        tsConfigFilePath: (() => {
          const tsconfig = path.join(options.root, 'tsconfig.json')
          return fs.existsSync(tsconfig) ? tsconfig : undefined
        })()
      }),
      // Resolve module-imported images to the same URL the rolldown dev SSR emits
      // (`.pylon/__pylon/static/media/…`, served by Hono) — no hydration mismatch.
      pylonImageVite(
        path.join(options.root, '.pylon', '__pylon', 'static', 'media'),
        '/__pylon/static'
      ),
      // Append the hydration bootstrap to the client `app.tsx` (client transform only).
      injectHydrationVite(options.version, options.appTsxAbs)
    ]
  })

  // The browser error overlay is the surface an app author reads on a broken edit —
  // normalize what it renders too, not just the terminal.
  patchViteOverlayMessages(server)

  const appTsxUrl =
    '/' + path.relative(options.root, options.appTsxAbs).split(path.sep).join('/')

  const bridge: PagesDevBridge = {
    transformHtml: (url, html) => server.transformIndexHtml(url, html),
    clientEntry: appTsxUrl,
    reloadBrowser: () => {
      const hot = (server as any).hot ?? (server as any).ws
      hot?.send?.({type: 'full-reload'})
    }
  }
  ;(globalThis as any).__PYLON_PAGES_DEV__ = bridge

  const frontPort: PagesDevServer['frontPort'] = async (fetch, port) => {
    // Topology A: Vite middlewares first (via the shared http.Server above); unclaimed
    // requests → the booted Pylon app.
    honoListener = getRequestListener(fetch)
    await new Promise<void>(resolve =>
      httpServer.listen(port, () => {
        console.log(`Pylon running at http://localhost:${port}`)
        resolve()
      })
    )
  }

  return {
    frontPort,
    close: async () => {
      await server.close()
      // Force-drop still-open sockets before waiting on the close callback. A
      // long-lived SSE stream (e.g. a realtime `/events` connection) or the Vite
      // HMR WebSocket never ends on its own, so `httpServer.close()` alone would
      // wait forever for them — that's the `Ctrl+C` hang. `closeAllConnections`
      // (Node 18.2+) destroys them so `close()` actually resolves.
      await new Promise<void>(r => {
        httpServer.close(() => r())
        httpServer.closeAllConnections?.()
      })
    }
  }
}
