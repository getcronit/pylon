// bundler.ts
import type {Plugin, PylonConfig} from '@getcronit/pylon'
import esbuild, {context} from 'esbuild'
import esbuildPluginTsc from 'esbuild-plugin-tsc'

import fs from 'fs/promises'
import path from 'path'
import {updateFileIfChanged} from '../update-file-if-changed'
import {buildConfigFile} from './build-config'
import {
  InjectCodePluginOptions,
  injectCodePlugin
} from './plugins/inject-code-plugin'
import {NotifyPluginOptions, notifyPlugin} from './plugins/notify-plugin'

export interface BundlerBuildOptions {
  getBuildDefs: InjectCodePluginOptions['getBuildDefs']
  onBuild?: NotifyPluginOptions['onBuild']
  skipInitialBuild?: boolean
}

export class Bundler {
  sfiFilePath: string
  outputDir: string

  constructor(sfiFilePath: string, outputDir: string = './.pylon') {
    this.sfiFilePath = sfiFilePath
    this.outputDir = outputDir
  }

  private async initBuildPlugins(args: {onBuild: () => void}) {
    const configPath = path.join(process.cwd(), this.outputDir, 'config.js')

    // Config now lives in a standalone `pylon.config.ts` (loaded by direct
    // bundle), not an inline `config` export in the entry.
    await buildConfigFile(process.cwd(), configPath)

    // `config.js` is ALWAYS emitted by buildConfigFile (an empty `{}` when there's
    // no pylon.config). So a throw here means pylon.config EXISTS but failed to
    // evaluate — fail the build LOUDLY rather than silently continuing with zero
    // plugins (which would boot the app with no db/auth/app/pages).
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

    const plugins = config?.plugins || []

    for (const plugin of plugins) {
      if (plugin.build) {
        const ctx = plugin.build({onBuild: args.onBuild})

        buildContexts.push(ctx)
      }
    }

    return buildContexts
  }

  public async build(options: BundlerBuildOptions) {
    const inputPath = path.join(process.cwd(), this.sfiFilePath)
    const dir = path.join(process.cwd(), this.outputDir)

    // Create directory if it doesn't exist
    await fs.mkdir(dir, {recursive: true})

    const writeOnEndPlugin: esbuild.Plugin = {
      name: 'write-on-end',
      setup(build) {
        build.onEnd(async result => {
          // Don't write artifacts for a failed build — `outputFiles` is undefined
          // on error (the non-null assertion would throw), and a half-build must
          // never be emitted.
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
        notifyPlugin({
          dir,
          onBuild: async output => {
            await options.onBuild?.(output)
          }
        }),
        injectCodePlugin({
          getBuildDefs: options.getBuildDefs,
          outputDir: this.outputDir
        }),
        esbuildPluginTsc({
          tsconfigPath: path.join(process.cwd(), 'tsconfig.json')
        }),
        writeOnEndPlugin
      ]
    })

    // Anything that throws AFTER the esbuild context is created (a failed initial
    // build, a config that won't load) must DISPOSE the context — otherwise the
    // esbuild service keeps the process alive and the CLI hangs instead of failing
    // fast.
    let pluginCtxs: ReturnType<NonNullable<Plugin['build']>>[]
    try {
      if (!options.skipInitialBuild) {
        await ctx.rebuild()
      }

      pluginCtxs = await this.initBuildPlugins({
        onBuild: () => {
          options.onBuild?.({
            totalFiles: 0,
            totalSize: 0,
            schemaChanged: false,
            duration: 0
          })
        }
      })

      if (!options.skipInitialBuild) {
        for (const pluginCtx of pluginCtxs) {
          const c = await pluginCtx

          await c.rebuild()
        }
      }
    } catch (e) {
      await ctx.dispose().catch(() => {})
      throw e
    }

    return {
      watch: async () => {
        for (const ctx of pluginCtxs) {
          const c = await ctx

          await c.watch()
        }

        return await ctx.watch()
      },
      rebuild: async () => {
        for (const ctx of pluginCtxs) {
          const c = await ctx

          await c.rebuild()
        }

        await ctx.rebuild()
      },
      dispose: async () => {
        for (const ctx of pluginCtxs) {
          const c = await ctx

          await c.dispose()
        }

        await ctx.dispose()
      },
      cancel: async () => {
        for (const ctx of pluginCtxs) {
          const c = await ctx

          await c.cancel()
        }

        await ctx.cancel()
      }
    }
  }
}
