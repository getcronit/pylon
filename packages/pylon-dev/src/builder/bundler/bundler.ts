// bundler.ts
import {context} from 'esbuild'
import esbuildPluginTsc from 'esbuild-plugin-tsc'

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

    return ctx
  }
}
