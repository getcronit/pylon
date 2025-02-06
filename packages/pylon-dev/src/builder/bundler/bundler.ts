// bundler.ts
import {context} from 'esbuild'
import esbuildPluginTsc from 'esbuild-plugin-tsc'
import type {PylonConfig} from '@getcronit/pylon'

import path from 'path'
import {
  InjectCodePluginOptions,
  injectCodePlugin
} from './plugins/inject-code-plugin'
import {NotifyPluginOptions, notifyPlugin} from './plugins/notify-plugin'

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

  private async loadAndExexConfigPluginsBuild() {
    const configPath = path.join(process.cwd(), this.outputDir, 'index.js')

    let config: PylonConfig | undefined
    try {
      let configModule = await import(configPath)

      config = configModule.config
    } catch (e) {
      console.error('Error loading config', e)
    }

    const plugins = config?.plugins || []

    for (const plugin of plugins) {
      if (plugin.build) {
        await plugin.build()
      }
    }
  }

  public async build(options: BundlerBuildOptions) {
    const inputPath = path.join(process.cwd(), this.sfiFilePath)
    const dir = path.join(process.cwd(), this.outputDir)

    const ctx = await context({
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
          onBuild: options.onBuild
        }),
        injectCodePlugin({
          getBuildDefs: options.getBuildDefs,
          outputDir: this.outputDir
        }),
        esbuildPluginTsc({
          tsconfigPath: path.join(process.cwd(), 'tsconfig.json')
        })
      ]
    })

    await this.loadAndExexConfigPluginsBuild()

    return ctx
  }
}
