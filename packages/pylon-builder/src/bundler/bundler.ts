// bundler.ts
import fs from 'fs'
import chokidar from 'chokidar'
import {Plugin, build} from 'esbuild'
import esbuildPluginTsc from 'esbuild-plugin-tsc'

import path from 'path'
import consola from 'consola'

export interface BundlerBuildOptions {
  getTypeDefs: () => string
  watch?: boolean
  onWatch?: (schemaChanged: boolean) => void
}

export class Bundler {
  sfiFilePath: string
  outputDir: string

  private cachedTypeDefs: string | null = null

  constructor(sfiFilePath: string, outputDir: string = './.pylon') {
    this.sfiFilePath = sfiFilePath
    this.outputDir = outputDir
  }

  public async build(options: BundlerBuildOptions): Promise<void> {
    const buildOnce = async () => {
      const typeDefs = options.getTypeDefs()

      const injectCodePlugin: Plugin = {
        name: 'inject-code',
        setup(build) {
          build.onLoad(
            {filter: /\/src\/index\.ts$/, namespace: 'file'},
            async args => {
              const contents = await fs.promises.readFile(args.path, 'utf-8')

              return {
                loader: 'ts',
                contents:
                  contents +
                  `
      import {graphqlHandler} from "@getcronit/pylon"        
      app.use('/graphql', async c => {
        const typeDefs = ${JSON.stringify(typeDefs)}
        const resolvers = graphql
      
        let exCtx = undefined
      
        try {
          exCtx = c.executionCtx
        } catch (e) {}
  
        return graphqlHandler(c)({
          typeDefs,
          resolvers
        }).fetch(c.req.raw, c.env, exCtx || {})
      })  
      `
              }
            }
          )
        }
      }

      const inputPath = path.join(process.cwd(), this.sfiFilePath)
      const dir = path.join(process.cwd(), this.outputDir)

      // Delete the output directory if it exists
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, {recursive: true})
      }

      const output = await build({
        logLevel: 'silent',
        entryPoints: [inputPath],
        outdir: dir,
        bundle: true,
        format: 'esm',
        sourcemap: 'inline',
        packages: 'external',
        plugins: [
          injectCodePlugin,
          esbuildPluginTsc({
            tsconfigPath: path.join(process.cwd(), 'tsconfig.json')
          })
        ]
      })

      if (output.errors.length > 0) {
        for (const error of output.errors) {
          consola.error(error)
        }

        throw new Error('Failed to build Pylon')
      }

      if (output.warnings.length > 0) {
        for (const warning of output.warnings) {
          consola.warn(warning)
        }
      }

      const changedSchema = this.cachedTypeDefs !== typeDefs

      this.cachedTypeDefs = typeDefs

      return changedSchema
    }

    if (options.watch) {
      const folder = path.dirname(this.sfiFilePath)

      chokidar.watch(folder).on('change', async () => {
        try {
          const changedSchema = await buildOnce()

          if (options.onWatch) {
            options.onWatch(changedSchema)
          }
        } catch (e) {
          consola.error(e)
        }
      })
    }

    await buildOnce()
  }
}
