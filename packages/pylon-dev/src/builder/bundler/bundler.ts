// bundler.ts
import type {Plugin, PylonConfig} from '@getcronit/pylon'
import esbuild, {context} from 'esbuild'
import esbuildPluginTsc from 'esbuild-plugin-tsc'

import fs from 'fs/promises'
import path from 'path'
import {updateFileIfChanged} from '../update-file-if-changed'
import {buildConfigFile} from './build-config'
import {InjectCodePluginOptions, injectCodePlugin} from './plugins/inject-code-plugin'
import {notifyPlugin} from './plugins/notify-plugin'

export interface ServerBuildResult {
  totalFiles: number
  totalSize: number
  schemaChanged: boolean
  duration: number
}

export interface BundlerBuildOptions {
  getBuildDefs: InjectCodePluginOptions['getBuildDefs']
}

/**
 * Owns the esbuild contexts (the server bundle + each build-plugin's contexts,
 * e.g. usePages' client/server). It does NOT decide WHEN to build or restart —
 * the caller (build/dev command) drives an explicit, ordered sequence:
 *
 *   buildServer()  → .pylon/index.js + schema.graphql
 *   <caller generates the gqty client from the schema>
 *   buildPages()   → page bundles + manifests (now `./client` exists)
 *   <caller (re)starts the server — all artifacts present>
 *
 * This ordering is the whole point: page bundles import the generated client, and
 * the server reads the page manifest at boot, so client-gen must precede the page
 * build and the server (re)start must follow it. Conflating them (the old single
 * `onBuild`) is why dev served stale/empty manifests.
 */
export class Bundler {
  sfiFilePath: string
  outputDir: string

  constructor(sfiFilePath: string, outputDir: string = './.pylon') {
    this.sfiFilePath = sfiFilePath
    this.outputDir = outputDir
  }

  private async initBuildPlugins() {
    const configPath = path.join(process.cwd(), this.outputDir, 'config.js')

    // Config now lives in a standalone `pylon.config.ts` (loaded by direct bundle).
    await buildConfigFile(process.cwd(), configPath)

    // `config.js` is ALWAYS emitted by buildConfigFile (an empty `{}` when there's
    // no pylon.config). So a throw here means pylon.config EXISTS but failed to
    // evaluate — fail LOUDLY rather than booting with zero plugins.
    let config: PylonConfig | undefined
    try {
      config = (await import(configPath)).config
    } catch (e) {
      throw new Error(
        'Failed to load pylon.config — aborting build (the app would otherwise run ' +
          `with NO plugins). Cause: ${e instanceof Error ? e.stack ?? e.message : String(e)}`
      )
    }

    const buildContexts: ReturnType<NonNullable<Plugin['build']>>[] = []
    for (const plugin of config?.plugins || []) {
      // Build plugins are driven manually via buildPages(); they no longer trigger
      // restarts themselves (the command sequences that), so onBuild is a no-op.
      if (plugin.build) buildContexts.push(plugin.build({onBuild: () => {}}))
    }
    return buildContexts
  }

  public async build(options: BundlerBuildOptions) {
    const inputPath = path.join(process.cwd(), this.sfiFilePath)
    const dir = path.join(process.cwd(), this.outputDir)

    await fs.mkdir(dir, {recursive: true})

    // The latest server-build result (schema-changed etc.), captured from the
    // notify plugin's onEnd and returned by buildServer().
    let lastServerBuild: ServerBuildResult | undefined

    const writeOnEndPlugin: esbuild.Plugin = {
      name: 'write-on-end',
      setup(build) {
        build.onEnd(async result => {
          // Never emit artifacts for a failed build (outputFiles is undefined).
          if (result.errors.length > 0 || !result.outputFiles) return
          await Promise.all(
            result.outputFiles.map(async file => {
              await fs.mkdir(path.dirname(file.path), {recursive: true})
              await updateFileIfChanged(file.path, file.text)
            })
          )
        })
      }
    }

    const ctx = await context({
      write: false,
      platform: 'node',
      logLevel: 'silent',
      metafile: true,
      entryPoints: [inputPath],
      outdir: dir,
      bundle: true,
      format: 'esm',
      sourcemap: 'inline',
      packages: 'external',
      plugins: [
        notifyPlugin({dir, onBuild: output => void (lastServerBuild = output)}),
        injectCodePlugin({getBuildDefs: options.getBuildDefs, outputDir: this.outputDir}),
        esbuildPluginTsc({tsconfigPath: path.join(process.cwd(), 'tsconfig.json')}),
        writeOnEndPlugin
      ]
    })

    // Create the build-plugin contexts. If config/plugin init throws, dispose the
    // esbuild service so the CLI fails fast instead of hanging on a live service.
    let pluginCtxs: ReturnType<NonNullable<Plugin['build']>>[]
    try {
      pluginCtxs = await this.initBuildPlugins()
    } catch (e) {
      await ctx.dispose().catch(() => {})
      throw e
    }

    return {
      /** Build the server bundle (→ schema.graphql). Returns schema-changed info. */
      buildServer: async (): Promise<ServerBuildResult | undefined> => {
        await ctx.rebuild()
        return lastServerBuild
      },
      /** Build the page contexts (→ manifests). Run AFTER the client is generated. */
      buildPages: async (): Promise<void> => {
        for (const p of pluginCtxs) await (await p).rebuild()
      },
      dispose: async (): Promise<void> => {
        for (const p of pluginCtxs) await (await p).dispose().catch(() => {})
        await ctx.dispose()
      },
      cancel: async (): Promise<void> => {
        for (const p of pluginCtxs) await (await p).cancel().catch(() => {})
        await ctx.cancel()
      }
    }
  }
}
