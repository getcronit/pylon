// bundler.ts — the server is NOT bundled. This owns: generating the runtime glue
// (`server.mjs` + `schema.mjs` + `resolvers.js` + `schema.graphql`) from the
// type-introspected schema, optionally transpiling `src/** → .pylon/**` for `pylon build`,
// and hosting the build-PLUGIN contexts (usePages' client/server bundles — those stay
// bundled). It does NOT decide WHEN to build; the caller drives the ordered sequence:
//
//   buildServer()  → glue (+ transpile in build mode), reports schemaChanged
//   <caller generates the gqty client from the schema>
//   buildPages()   → page bundles + manifests (now `./client` exists)
//   <caller (re)starts the server: dev = loader on src; build = node on .pylon/**>
import type {BuildContext, Plugin, PylonConfig} from '@getcronit/pylon'

import fs from 'fs/promises'
import path from 'path'
import {pathToFileURL} from 'node:url'

import {findConfigFile} from './build-config'
import {emitServerGlue} from './emit-server-glue'
import {transpileApp} from './transpile-app'

export interface ServerBuildResult {
  schemaChanged: boolean
  duration: number
  /** Retained for analytics compatibility; not meaningful without a bundle. */
  totalFiles?: number
  totalSize?: number
}

export type BuildMode = 'dev' | 'build'

export interface BundlerBuildOptions {
  getBuildDefs: () => {
    typeDefs: string
    resolvers: Record<string, {__resolveType?: (obj: any) => string}>
  }
  /** dev = run `src/**` live via the loader; build = transpile to `.pylon/**` for plain
   *  `node`. Defaults to 'dev'. */
  mode?: BuildMode
}

export class Bundler {
  sfiFilePath: string
  outputDir: string

  constructor(sfiFilePath: string, outputDir: string = './.pylon') {
    this.sfiFilePath = sfiFilePath
    this.outputDir = outputDir
  }

  /** Read `config.plugins` to set up the page build contexts. The config is imported
   *  IN-PROCESS through tsx (the same loader the dev server uses) — no bundled config
   *  artifact. The RUNTIME config is `pylon.config.ts` itself (dev, via the loader) or its
   *  transpiled `.pylon/pylon.config.js` (build). */
  private async initBuildPlugins(configAbs: string | null, buildCtx: BuildContext) {
    let config: PylonConfig = {}
    if (configAbs) {
      // Non-literal specifier so tsc doesn't demand types for tsx's runtime-only API.
      const tsxApi = 'tsx/esm/api'
      const {register} = (await import(tsxApi)) as {register: () => () => void}
      const unregister = register()
      try {
        const m: any = await import(pathToFileURL(configAbs).href)
        const resolved = m.default ?? m.config ?? {}
        config = typeof resolved === 'function' ? await resolved() : resolved
      } catch (e) {
        throw new Error(
          'Failed to load pylon.config — aborting build (the app would otherwise run ' +
            `with NO plugins). Cause: ${e instanceof Error ? e.stack ?? e.message : String(e)}`
        )
      } finally {
        unregister()
      }
    }

    const buildContexts: ReturnType<NonNullable<Plugin['build']>>[] = []
    for (const plugin of config?.plugins || []) {
      if (plugin.build) buildContexts.push(plugin.build(buildCtx))
    }
    return buildContexts
  }

  public async build(options: BundlerBuildOptions) {
    const cwd = process.cwd()
    const mode = options.mode ?? 'dev'
    const dir = path.join(cwd, this.outputDir)
    const entryAbs = path.join(cwd, this.sfiFilePath)
    const configAbs = findConfigFile(cwd)
    const srcDir = path.join(cwd, path.dirname(this.sfiFilePath)) // e.g. <cwd>/src

    await fs.mkdir(dir, {recursive: true})

    // Page build contexts (usePages etc.). If config/plugin init throws, surface it.
    // `out` is the shared upstream-output slot; populated as more stages move into
    // the pipeline (Pillar 1 keeps it empty — usePages resolves paths off cwd today).
    const buildCtx: BuildContext = {mode, root: cwd, srcDir, outDir: dir, out: {}}
    const pluginCtxs = await this.initBuildPlugins(configAbs, buildCtx)

    const buildServer = async (): Promise<ServerBuildResult> => {
      const start = Date.now()
      const {typeDefs, resolvers} = options.getBuildDefs()

      if (mode === 'build') {
        // Ahead-of-time: transpile the app tree (+ config) to `.pylon/**` with native-ESM
        // import extensions, so plain `node .pylon/server.mjs` resolves it. The glue points
        // at the transpiled outputs.
        const {entryOut, configOut} = await transpileApp({
          cwd,
          srcDir,
          entryAbs,
          configAbs,
          outDir: dir
        })
        const {schemaChanged} = await emitServerGlue({
          typeDefs,
          resolvers,
          outputDir: dir,
          appImport: './' + path.relative(dir, entryOut).split(path.sep).join('/'),
          configImport: configOut
            ? './' + path.relative(dir, configOut).split(path.sep).join('/')
            : null
        })
        return {schemaChanged, duration: Date.now() - start}
      }

      // dev: the loader runs `src/**` + `pylon.config.*` live; the glue imports them by
      // their absolute source paths (one Node module graph → one model object per file).
      const {schemaChanged} = await emitServerGlue({
        typeDefs,
        resolvers,
        outputDir: dir,
        appImport: pathToFileURL(entryAbs).href,
        configImport: configAbs ? pathToFileURL(configAbs).href : null,
        // Dev: also emit dev-worker.mjs for the persistent-worker hot-swap loop.
        devWorker: true
      })
      return {schemaChanged, duration: Date.now() - start}
    }

    return {
      /** Generate the runtime glue (+ transpile in build mode). Returns schema-changed. */
      buildServer,
      /** Build the page contexts (→ manifests). Run AFTER the client is generated. */
      buildPages: async (): Promise<void> => {
        for (const p of pluginCtxs) await (await p).rebuild()
      },
      dispose: async (): Promise<void> => {
        for (const p of pluginCtxs) await (await p).dispose().catch(() => {})
      },
      cancel: async (): Promise<void> => {
        for (const p of pluginCtxs) await (await p).cancel?.().catch(() => {})
      }
    }
  }
}
