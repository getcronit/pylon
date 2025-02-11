// bundler.ts
import esbuild, {context} from 'esbuild'
import esbuildPluginTsc from 'esbuild-plugin-tsc'
import type {PylonConfig, Plugin} from '@getcronit/pylon'

import path from 'path'
import fs from 'fs/promises'
import {
  InjectCodePluginOptions,
  injectCodePlugin
} from './plugins/inject-code-plugin'
import {NotifyPluginOptions, notifyPlugin} from './plugins/notify-plugin'
import {updateFileIfChanged} from '../update-file-if-changed'

export interface BundlerBuildOptions {
  getBuildDefs: InjectCodePluginOptions['getBuildDefs']
  onBuild?: NotifyPluginOptions['onBuild']
}

export class Bundler {
  sfiFilePath: string
  outputDir: string

  constructor(sfiFilePath: string, outputDir: string = './.pylon') {
    this.sfiFilePath = sfiFilePath
    this.outputDir = outputDir
  }

  private async initBuildPlugins(args: {onBuild: () => void}) {
    const configPath = path.join(process.cwd(), this.outputDir, 'index.js')

    let config: PylonConfig | undefined
    try {
      let configModule = await import(configPath)

      config = configModule.config
    } catch (e) {
      console.error('Error loading config', e)
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
          result.outputFiles?.forEach(async file => {
            await fs.mkdir(path.dirname(file.path), {recursive: true})
            await updateFileIfChanged(file.path, file.text)
          })
        })
      }
    }

    const ctx = await context({
      write: false,
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

    const pluginCtxs = await this.initBuildPlugins({
      onBuild: () => {
        options.onBuild?.({
          totalFiles: 0,
          totalSize: 0,
          schemaChanged: false,
          duration: 0
        })
      }
    })

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
