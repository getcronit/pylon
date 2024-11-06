// bundler.ts
import fs from 'fs'
import chokidar from 'chokidar'
import {Plugin, build} from 'esbuild'
import esbuildPluginTsc from 'esbuild-plugin-tsc'

import path from 'path'
import consola from 'consola'

export interface BundlerBuildOptions {
  getBuildDefs: () => {
    typeDefs: string
    resolvers: Record<
      string,
      {
        __resolveType?: (obj: any) => string
      }
    >
  }
  watch?: boolean
  onWatch?: (output: {
    totalFiles: number
    totalSize: number
    schemaChanged: boolean
    duration: number
  }) => void
}

export class Bundler {
  sfiFilePath: string
  outputDir: string

  private cachedTypeDefs: string | null = null

  constructor(sfiFilePath: string, outputDir: string = './.pylon') {
    this.sfiFilePath = sfiFilePath
    this.outputDir = outputDir
  }

  public async build(options: BundlerBuildOptions) {
    const buildOnce = async () => {
      const startTime = Date.now()

      const {typeDefs, resolvers: baseResolvers} = options.getBuildDefs()

      const injectCodePlugin: Plugin = {
        name: 'inject-code',
        setup(build) {
          build.onLoad(
            {filter: /(\/src\/index\.ts|\\src\\index\.ts)$/, namespace: 'file'},
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
        const resolvers = {
                ...graphql,
                ...${prepareObjectInjection(baseResolvers)}
        }

        console.log('resolvers', resolvers)
      
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

      const output = await build({
        logLevel: 'silent',
        metafile: true,
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

      fs.writeFileSync(path.join(dir, 'schema.graphql'), typeDefs, 'utf-8')

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

      const schemaChanged = this.cachedTypeDefs !== typeDefs

      this.cachedTypeDefs = typeDefs

      const duration = Date.now() - startTime

      const totalFiles = Object.keys(output.metafile.inputs).length
      const totalSize = Object.values(output.metafile.outputs).reduce(
        (acc, output) => acc + output.bytes,
        0
      )

      return {
        totalFiles,
        totalSize,
        schemaChanged,
        duration
      }
    }

    if (options.watch) {
      const folder = path.dirname(this.sfiFilePath)

      chokidar.watch(folder).on('change', async () => {
        try {
          const output = await buildOnce()

          if (options.onWatch) {
            options.onWatch(output)
          }
        } catch (e) {
          consola.error(e)
        }
      })
    }

    return await buildOnce()
  }
}

function prepareObjectInjection(obj: object) {
  const entries = Object.entries(obj).map(([key, value]) => {
    if (value === undefined) {
      return undefined
    } else if (typeof value === 'string') {
      return `${key}:${value}`
    } else if (typeof value === 'function') {
      return `${key}:${value.toString()}`
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      return `${key}:${prepareObjectInjection(value)}`
    } else {
      return `${key}:${JSON.stringify(value)}`
    }
  })

  return `{${entries.join(',')}}`
}
