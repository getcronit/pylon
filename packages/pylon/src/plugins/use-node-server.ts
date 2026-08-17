import {type Plugin} from '../core/index'

export interface NodeServerOptions {
  /** Port to bind. Defaults to `process.env.PORT` then `3000`. */
  port?: number
}

/**
 * Serve the Pylon app on Node via `@hono/node-server`.
 *
 * Serving is an EXPLICIT, app-owned capability — not a hidden side effect of importing
 * the built entry. The generated entry is pure (`export default app`); an app opts into
 * Node serving by adding this `'last'`-strategy plugin to its `pylon.config` (put it LAST
 * so the port binds only after every route — incl. the usePages catch-all — is mounted).
 * Bun / workerd / Deno need no plugin: they auto-serve the default-exported app.
 *
 * In dev (`NODE_ENV==='development'`, set by `pylon dev`) this NO-OPs: `pylon dev` owns
 * serving (plainly for an API, or Vite-fronted for usePages), so binding here would
 * double-bind / fight the dev server. `@hono/node-server` is imported lazily so it never
 * enters the static graph traced for non-Node runtimes.
 */
export function useNodeServer(options: NodeServerOptions = {}): Plugin {
  return {
    name: 'node-server',
    strategy: 'last',
    setup: async app => {
      if (process.env.NODE_ENV === 'development') return

      const port = options.port ?? (Number(process.env.PORT) || 3000)
      // Non-literal specifier so tsc doesn't demand @hono/node-server's types here
      // (it's a runtime-only, Node-only dep; mirrors the `tsx/esm/api` pattern in the
      // bundler). Available wherever a Node app actually runs.
      const nodeServer = '@hono/node-server'
      const {serve} = (await import(nodeServer)) as {
        serve: (
          options: {fetch: typeof app.fetch; port: number},
          listeningListener?: (info: {port: number}) => void
        ) => void
      }
      serve({fetch: app.fetch, port}, info =>
        console.log(`Pylon running at http://localhost:${info.port}`)
      )
    }
  }
}
