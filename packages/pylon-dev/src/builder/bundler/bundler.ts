// bundler.ts
import esbuild, {context} from 'esbuild'
import esbuildPluginTsc from 'esbuild-plugin-tsc'

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

  public async build(options: BundlerBuildOptions) {
    const inputPath = path.join(process.cwd(), this.sfiFilePath)
    const dir = path.join(process.cwd(), this.outputDir)

    // Create directory if it doesn't exist
    await fs.mkdir(dir, {recursive: true})

    const writeOnEndPlugin: esbuild.Plugin = {
      name: 'write-on-end',
      setup(build) {
        build.onEnd(async result => {
          await Promise.all(
            result.outputFiles!.map(async file => {
              await fs.mkdir(path.dirname(file.path), {recursive: true})
              await updateFileIfChanged(file.path, file.text)
            })
          )
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

    await ctx.rebuild()

    return ctx
  }
}
