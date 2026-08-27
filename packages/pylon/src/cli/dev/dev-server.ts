/**
 * The direct-execution dev server (rfcs/DEV_SERVER.md — Stage B).
 *
 * ONE process runs `src/index.ts` directly through Vite's backend runner, compiles the
 * schema IN-PROCESS (the warm type-introspection compiler, `build().compile`), and boots
 * the app with the SAME framework functions the prod glue uses
 * (`executeConfig → handler → executeConfig 'last'`). A `src` edit recompiles + re-imports
 * + `swapSchema()` via a DIRECT call — no generated glue, no second process, no IPC.
 *
 * Pages (usePages) stay on the clean split: in-process `buildPages` (rolldown SSR + CSS)
 * + a client-only Vite (Fast Refresh). Prod is untouched (AOT glue → pure `server.mjs`).
 */
import fs from 'node:fs'
import path from 'node:path'
import {register} from 'node:module'

import chokidar from 'chokidar'
import consola from 'consola'

// Self-ref so this is the SAME framework instance the runner-imported app uses (durable
// registry/DB/ALS) and the swap hook (globalThis) is shared.
import {executeConfig, handler} from '@getcronit/pylon'

import {build} from '../builder/index.js'
import {buildClient} from '../builder/build-client.js'
import {findConfigFile} from '../builder/bundler/build-config.js'
import {createViteHotServer, type ViteHotServer} from './vite-hot-server.js'
import {sanitizeViteError} from './vite-messages.js'
import {keepInspectorOnParentOnly} from './inspector.js'

export interface DevServer {
  close(): Promise<void>
}

const swapHook = () =>
  (globalThis as any).__PYLON_DEV_SWAP_SCHEMA__ as
    | ((td: string, gql: unknown, res: Record<string, any> | undefined) => void)
    | undefined

export async function startDevServer(opts: {port: number}): Promise<DevServer> {
  const cwd = process.cwd()
  const entry = './src/index.ts'
  const entryAbs = path.join(cwd, entry)
  const outDir = path.join(cwd, '.pylon')
  process.env.NODE_ENV = 'development'
  process.env.PYLON_DEV = '1'
  // Node loader hooks for the externalized deps: stamp `type: 'json'` on .json (so a dep's bare
  // `require('./x.json')` doesn't need an import attribute) and no-op server-side .css imports.
  // Registered before anything loads the app. See dev-loader-hooks.ts.
  register('./dev-loader-hooks.js', import.meta.url)

  // Debugging `pylon dev`: hold the inspector on THIS process so the rolldown-vite workers we
  // spawn below don't race it for port 9229 (the "address already in use ×N" noise) and steal
  // the DevTools attach — your resolvers run here, so this is the process you want to break in.
  keepInspectorOnParentOnly()

  // If a debugger is attached — `pylon dev --inspect` opened it, or the process was launched with
  // --inspect — expose `inspector.console` so the logger's devtools format can stream expandable
  // record objects to the DevTools console WITHOUT echoing them to the terminal (raw stdout, which
  // the terminal line uses, is not forwarded to DevTools). Its presence is also how the logger
  // knows to pick the devtools format (see core/logger `inspectorActive`).
  try {
    const inspector = await import('node:inspector')
    if (inspector.url()) {
      ;(globalThis as {__PYLON_INSPECTOR_CONSOLE__?: unknown}).__PYLON_INSPECTOR_CONSOLE__ =
        inspector.console
    }
  } catch {
    /* non-Node dev host or no inspector — the logger stays on the pretty terminal line */
  }
  // The app root (dir containing `.pylon`) — in dev that's cwd. The usePages runtime resolves
  // its artifacts against this instead of process.cwd() (parity with the prod server.mjs).
  ;(globalThis as any).__PYLON_ROOT__ = cwd

  const usePages = fs.existsSync(path.join(cwd, 'pages'))

  // Compile (getBuildDefs, warm + cached) + pages build controls — NO glue emitted.
  const ctx = await build({sfiFilePath: entry, outputFilePath: './.pylon', mode: 'dev'})

  let prevTypeDefs = ''
  const compile = () => {
    const {typeDefs, resolvers} = ctx.compile()
    const schemaChanged = typeDefs !== prevTypeDefs
    prevTypeDefs = typeDefs
    return {typeDefs, resolvers, schemaChanged}
  }

  // Pages need the gqty/pylon-query client + the route bundle (rolldown SSR) + CSS. This
  // also generates `.pylon/app.tsx` (the Vite client entry). The gqty client gen + the
  // analyzer's document mode read `.pylon/schema.graphql` — so emit the SDL (a build
  // INPUT, not runtime boot glue like server.mjs/schema.mjs/resolvers.js).
  const buildPagesArtifacts = async (schemaChanged: boolean) => {
    if (!usePages) return
    fs.mkdirSync(outDir, {recursive: true})
    fs.writeFileSync(path.join(outDir, 'schema.graphql'), defs.typeDefs)
    if (schemaChanged) await buildClient({schemaChanged: true})
    await ctx.buildPages()
  }

  let defs = compile()
  await buildPagesArtifacts(true)

  // Runtime config (the actual plugin instances) — imported through the runner so its
  // plugins reference the SAME external framework.
  const configAbs = findConfigFile(cwd)
  const configId = configAbs
    ? '/' + path.relative(cwd, configAbs).split(path.sep).join('/')
    : null

  // --- one bootable "session" (torn down + rebuilt on a config edit) --------
  interface Session {
    reloadServer(): Promise<void>
    reloadPages(): Promise<void>
    teardown(): Promise<void>
  }

  const bootSession = async (): Promise<Session> => {
    // Backend runner: runs src + config; framework external → durable across swaps.
    const runner: ViteHotServer = await createViteHotServer({root: cwd, entryAbs})

    const loadConfig = async () => {
      if (!configId) return {plugins: []}
      const m = await runner.importId(configId)
      const r = m.default ?? m.config ?? {}
      return typeof r === 'function' ? await r() : r
    }

    // usePages: create the client Vite + install the __PYLON_PAGES_DEV__ bridge BEFORE
    // boot, so usePages setup wires its SSR seams to it.
    let pagesDev: {
      frontPort(fetch: any, port: number): Promise<void>
      close(): Promise<void>
    } | null = null
    if (usePages) {
      const {createPagesDevServer} = (await import('@getcronit/pylon/pages/dev')) as any
      // Read the usePages plugin's own options: the client analyzer must compile the same
      // documents the rolldown (SSR) one does, or dev's two halves disagree — see
      // PagesDevServerOptions.inContext. `usePages` above is only a `pages/` directory
      // check, so the real config is the only source for this.
      const pagesPlugin = (await loadConfig())?.plugins?.find(
        (p: any) => p?.name === 'pages'
      ) as {options?: {i18n?: unknown}} | undefined

      pagesDev = await createPagesDevServer({
        root: cwd,
        appTsxAbs: path.join(outDir, 'app.tsx'),
        version: 'dev',
        inContext: Boolean(pagesPlugin?.options?.i18n)
      })
    }

    // Boot in-process — identical to the glue's boot.
    const app = (await runner.importApp()).default
    const config = await loadConfig()
    ;(globalThis as any).__PYLON_APP__ = app
    await executeConfig(config, undefined, app)
    // typeDefs/resolvers are consumed by handler() via an internal cast (see the glue),
    // so they aren't on the public option type.
    app.use(handler({typeDefs: defs.typeDefs, graphql: app.graphql, resolvers: defs.resolvers} as any, app))
    await executeConfig(config, {pluginsStrategy: 'last'}, app)

    // Serve — Topology A (Vite fronts) for pages, plain @hono/node-server for an API.
    let closeServer: () => Promise<void>
    if (pagesDev) {
      await pagesDev.frontPort(app.fetch, opts.port)
      closeServer = () => pagesDev!.close()
    } else {
      const nodeServer = '@hono/node-server'
      const {serve} = (await import(nodeServer)) as any
      const s = serve(
        {fetch: app.fetch, port: opts.port},
        (info: any) => consola.success(`Pylon running at http://localhost:${info.port}`)
      )
      closeServer = () => new Promise<void>(r => (s.close ? s.close(() => r()) : r()))
    }

    return {
      reloadServer: async () => {
        defs = compile()
        if (defs.schemaChanged) {
          await buildPagesArtifacts(true)
          // Pages were rebuilt → their bundle hashes changed. Reload the in-memory pages
          // manifest too (as `reloadPages` does), otherwise the SSR runtime keeps serving —
          // or importing — the previous, now-replaced bundle hash.
          await (globalThis as any).__PYLON_DEV_RELOAD_PAGES__?.()
        }
        runner.invalidate()
        const next = (await runner.importApp()).default
        swapHook()?.(defs.typeDefs, next.graphql, defs.resolvers)
        // Server logic changed → full-reload the browser so pages re-fetch (component
        // edits are handled in place by Vite Fast Refresh).
        ;(globalThis as any).__PYLON_PAGES_DEV__?.reloadBrowser?.()
      },
      reloadPages: async () => {
        await ctx.buildPages() // keep the rolldown SSR fresh; Vite handles client HMR
        await (globalThis as any).__PYLON_DEV_RELOAD_PAGES__?.()
      },
      teardown: async () => {
        await closeServer().catch(() => {})
        await runner.close().catch(() => {})
      }
    }
  }

  let session = await bootSession()

  // --- watch + single-flight supervisor -------------------------------------
  const rank = {pages: 0, server: 1, config: 2} as const
  type Kind = keyof typeof rank
  const classify = (p: string): Kind => {
    const rel = path.relative(cwd, p)
    if (/(^|[/\\])pylon\.config\.[cm]?[jt]sx?$/.test(rel)) return 'config'
    if (rel === 'src' || rel.startsWith('src' + path.sep)) return 'server'
    return 'pages'
  }
  let pending: Kind | null = null
  let gen = 0
  let chain: Promise<void> = Promise.resolve()

  // --- SSR rebuild latch (dev) -------------------------------------------------
  // The instant a source file changes, Vite serves its new module to the browser ON-DEMAND,
  // but the SSR bundle is a rolldown artifact rebuilt asynchronously. Between the two a full
  // reload would SSR the STALE bundle while the browser loads the NEW client → hydration
  // mismatch. So we latch the SSR handler (it awaits `__PYLON_DEV_REBUILD__` before rendering)
  // the MOMENT a source file changes — not when the rebuild starts — and release it only once
  // the ensuing rebuild + manifest reload finish, making the two planes consistent by
  // construction. Dev server and SSR handler share one process, so a global is the seam. A
  // safety timeout guarantees a missed release can never wedge dev SSR.
  let releaseGate: (() => void) | null = null
  let gateTimeout: ReturnType<typeof setTimeout> | null = null
  const beginRebuild = () => {
    if (releaseGate) return // already latched for this burst of edits
    ;(globalThis as any).__PYLON_DEV_REBUILD__ = new Promise<void>(r => (releaseGate = r))
    gateTimeout = setTimeout(endRebuild, 10_000)
  }
  const endRebuild = () => {
    if (gateTimeout) clearTimeout(gateTimeout)
    gateTimeout = null
    ;(globalThis as any).__PYLON_DEV_REBUILD__ = undefined
    const release = releaseGate
    releaseGate = null
    release?.()
  }

  const sync = () => {
    const g = ++gen
    const kind = pending ?? 'server'
    pending = null
    chain = chain
      .then(async () => {
        if (g !== gen) return // superseded by a newer edit — its sync() releases the latch
        try {
          if (kind === 'config') {
            // Durable plugin graph changed → rebuild the whole session in-process.
            await session.teardown()
            session = await bootSession()
          } else if (kind === 'server') {
            await session.reloadServer()
          } else {
            await session.reloadPages()
          }
        } finally {
          endRebuild()
        }
      })
      .catch(e => {
        endRebuild()
        consola.error('reload failed:', sanitizeViteError(e))
      })
    return chain
  }

  // Only SOURCE-code edits trigger a reload — NOT the JSON/media/log files an app writes into
  // the project at runtime. We watch all of `cwd` (frontend source lives in arbitrary dirs like
  // components/, hooks/), so without this filter a request that writes a file loops: write →
  // reload → the request re-runs → writes again. node_modules/.pylon/.git are excluded below.
  // No `awaitWriteFinish`: the latch must fire on the FIRST event (any settle delay would
  // reopen the mismatch window), so we debounce the REBUILD instead — it reads files only after
  // 200ms of quiet, i.e. once writes have settled.
  const SOURCE_RE = /\.([cm]?[jt]sx?|css)$/
  const watcher = chokidar.watch(cwd, {
    ignoreInitial: true,
    ignored: (p: string) => /(^|[/\\])(node_modules|\.pylon|\.git)([/\\]|$)/.test(p)
  })
  let debounce: ReturnType<typeof setTimeout> | null = null
  watcher.on('all', (_ev, p) => {
    if (!SOURCE_RE.test(p)) return
    const k = classify(p)
    if (pending == null || rank[k] > rank[pending]) pending = k
    beginRebuild() // latch SSR immediately, ahead of the debounced rebuild
    consola.info(`[dev] ${k} reload — ${path.relative(cwd, p)}`)
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => void sync(), 200)
  })

  return {
    close: async () => {
      await watcher.close().catch(() => {})
      await session.teardown().catch(() => {})
      await ctx.dispose().catch(() => {})
    }
  }
}
