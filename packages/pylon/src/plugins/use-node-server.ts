import {type Plugin} from '../core/index'

export interface NodeServerOptions {
  /** Port to bind. Defaults to `process.env.PORT` then `3000`. */
  port?: number
}

/**
 * Is this a genuine Node runtime (so `@hono/node-server`'s `node:http` serve applies)?
 *
 * The SAME built artifact + `pylon.config` is meant to run on Node AND on Bun / Deno /
 * workerd — which auto-serve the `export default app` themselves. On those, `useNodeServer`
 * must NO-OP, or it double-binds (a second listener next to the host's) or crashes reaching
 * for `node:http`. Detection is by the tells each runtime sets, not a positive Node check
 * alone: Bun sets `process.versions.bun`, Deno exposes a `Deno` global, workerd reports
 * `navigator.userAgent === 'Cloudflare-Workers'` (and has no real Node `process`).
 */
export function isNodeRuntime(): boolean {
  const g = globalThis as any
  if (typeof g.Deno !== 'undefined') return false
  if (g.navigator?.userAgent === 'Cloudflare-Workers') return false
  if (typeof process === 'undefined' || !process.versions) return false
  if (process.versions.bun) return false
  return Boolean(process.versions.node)
}

/**
 * Serve the Pylon app on Node via `@hono/node-server`.
 *
 * Serving is an EXPLICIT, app-owned capability — not a hidden side effect of importing
 * the built entry. The generated entry is pure (`export default app`); an app opts into
 * Node serving by adding this `'last'`-strategy plugin to its `pylon.config` (put it LAST
 * so the port binds only after every route — incl. the usePages catch-all — is mounted).
 * Bun / workerd / Deno need no plugin: they auto-serve the default-exported app, and this
 * plugin no-ops there (see `isNodeRuntime`).
 *
 * In dev (`NODE_ENV==='development'`, set by `pylon dev`) this also NO-OPs: `pylon dev` owns
 * serving (plainly for an API, or Vite-fronted for usePages), so binding here would
 * double-bind / fight the dev server. `@hono/node-server` is imported lazily so it never
 * enters the static graph traced for non-Node runtimes.
 */
export function useNodeServer(options: NodeServerOptions = {}): Plugin {
  return {
    name: 'node-server',
    strategy: 'last',
    setup: async app => {
      // Non-Node runtimes auto-serve the default export — leave serving to the host.
      if (!isNodeRuntime()) return
      // On Node, `pylon dev` owns serving — don't double-bind against the dev server.
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
