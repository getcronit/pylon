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

import chokidar from 'chokidar'

// Self-ref so this is the SAME framework instance the runner-imported app uses (durable
// registry/DB/ALS) and the swap hook (globalThis) is shared.
import {executeConfig, handler} from '@getcronit/pylon'

import {build} from '../builder/index.js'
import {buildClient} from '../builder/build-client.js'
import {findConfigFile} from '../builder/bundler/build-config.js'
import {createViteHotServer, type ViteHotServer} from './vite-hot-server.js'

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
      pagesDev = await createPagesDevServer({
        root: cwd,
        appTsxAbs: path.join(outDir, 'app.tsx'),
        version: 'dev'
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
        (info: any) => console.log(`Pylon running at http://localhost:${info.port}`)
      )
      closeServer = () => new Promise<void>(r => (s.close ? s.close(() => r()) : r()))
    }

    return {
      reloadServer: async () => {
        defs = compile()
        if (defs.schemaChanged) await buildPagesArtifacts(true)
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
  const sync = () => {
    const g = ++gen
    const kind = pending ?? 'server'
    pending = null
    chain = chain
      .then(async () => {
        if (g !== gen) return
        if (kind === 'config') {
          // Durable plugin graph changed → rebuild the whole session in-process.
          await session.teardown()
          session = await bootSession()
        } else if (kind === 'server') {
          await session.reloadServer()
        } else {
          await session.reloadPages()
        }
      })
      .catch(e => console.error('[pylon] reload failed:', e))
    return chain
  }

  const watcher = chokidar.watch(cwd, {
    ignoreInitial: true,
    ignored: (p: string) => /(^|[/\\])(node_modules|\.pylon|\.git)([/\\]|$)/.test(p),
    awaitWriteFinish: {stabilityThreshold: 200, pollInterval: 50}
  })
  watcher.on('all', (_ev, p) => {
    const k = classify(p)
    if (pending == null || rank[k] > rank[pending]) pending = k
    void sync()
  })

  return {
    close: async () => {
      await watcher.close().catch(() => {})
      await session.teardown().catch(() => {})
      await ctx.dispose().catch(() => {})
    }
  }
}
