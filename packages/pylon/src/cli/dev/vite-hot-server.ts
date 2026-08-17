/**
 * DEV-ONLY server-plane hot engine (rfcs/DEV_SERVER.md Step 2).
 *
 * Stands up a rolldown-vite dev server in middleware mode purely as a **module
 * runner**: it re-executes the app's `src/**` graph on demand so a `src` edit yields
 * fresh resolver closures — WITHOUT a process restart. The framework
 * (`@getcronit/pylon`) is `ssr.external`, so it stays a single durable Node instance:
 * the model registry, DB connection, identity, queues, ALS and bound port all survive
 * the swap.
 *
 * The swap itself goes through `globalThis.__PYLON_DEV_SWAP_SCHEMA__` (the seam in
 * `app/pylon-handler.ts`): the dev server rebuilds the executable schema from fresh
 * `typeDefs` + `graphql` + base `resolvers` and swaps Yoga's schema ref in place.
 *
 * This module is reached ONLY from `pylon dev` (the direct-execution supervisor). Prod's
 * `server.mjs` never imports it, so Vite never enters the production/nft graph.
 */
import path from 'path'

export interface ViteHotServerOptions {
  /** Project root (the consumer app's cwd). */
  root: string
  /** Absolute path to the app entry the runner re-executes (e.g. `<cwd>/src/index.ts`). */
  entryAbs: string
  /** Extra bare specifiers to force `ssr.external` (framework is always external). */
  external?: string[]
}

export interface ViteHotServer {
  /** Re-run the app graph and return the fresh module (`.default` = the Pylon app). */
  importApp(): Promise<any>
  /** Run any root-relative module through the runner (e.g. the config). */
  importId(id: string): Promise<any>
  /** Invalidate the app graph so the next `importApp` re-executes it (+ its changed deps). */
  invalidate(): void
  /** Close the underlying Vite dev server. */
  close(): Promise<void>
}

export async function createViteHotServer(
  options: ViteHotServerOptions
): Promise<ViteHotServer> {
  // Non-literal specifier: rolldown-vite is a heavy dev-only dep loaded lazily; keeping
  // the specifier out of the static graph also avoids demanding its types at build time
  // (mirrors the `tsx/esm/api` pattern in the bundler).
  const viteMod = 'rolldown-vite'
  const {createServer} = (await import(viteMod)) as {
    createServer: (config: any) => Promise<any>
  }

  const server = await createServer({
    root: options.root,
    configFile: false,
    logLevel: 'warn',
    // Middleware mode + no client HMR / no ws / no file watching: this instance is ONLY
    // a server-side module runner. `ws:false` is load-bearing — otherwise it would open
    // a second HMR WebSocket and collide with the usePages dev server on port 24678.
    server: {middlewareMode: true, hmr: false, ws: false, watch: null},
    appType: 'custom',
    // Distinct dep-cache dir from the usePages dev server (which also runs in this
    // worker) — a shared `node_modules/.vite` makes the two clobber each other's optimize
    // hashes → "Outdated Optimize Dep" 504s in the browser.
    cacheDir: path.join(options.root, 'node_modules', '.vite-pylon-runner'),
    // This runner never serves a browser and imports only server `src` (framework
    // external), so it needs no browser dep pre-bundling — skip discovery entirely.
    optimizeDeps: {noDiscovery: true, include: []},
    // Keep the framework (and its deps) a single durable Node instance shared with the
    // tsx-loaded server.mjs — the make-or-break for the swap.
    ssr: {external: ['@getcronit/pylon', ...(options.external ?? [])]}
  })

  // Prefer the modern Environment-API ModuleRunner; fall back to legacy ssrLoadModule.
  const runner = server.environments?.ssr?.runner
  const ssrGraph = server.environments?.ssr?.moduleGraph ?? server.moduleGraph

  // Root-relative id the runner resolves (e.g. `/src/index.ts`).
  const entryId =
    '/' + path.relative(options.root, options.entryAbs).split(path.sep).join('/')

  const importId = async (id: string): Promise<any> => {
    if (runner?.import) return runner.import(id)
    return server.ssrLoadModule(id)
  }
  const importEntry = (): Promise<any> => importId(entryId)

  return {
    importApp: importEntry,
    importId,
    // Invalidate the app graph so the entry + its (changed) deps re-execute. Externals
    // (framework, node_modules) are not in this graph → untouched, so state is durable.
    invalidate: () => ssrGraph?.invalidateAll?.(),
    close: () => server.close()
  }
}
