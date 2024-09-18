import path from 'path'
import {Bundler} from './bundler/bundler.js'
import {SchemaBuilder} from './schema/builder.js'

export interface BuildOptions {
  sfiFilePath: string
  outputFilePath: string
  watch?: boolean
  onWatch?: (output: {
    totalFiles: number
    totalSize: number
    schemaChanged: boolean
    duration: number
  }) => void
}

export {SchemaBuilder}

export const build = async (options: BuildOptions) => {
  const bundler = new Bundler(options.sfiFilePath, options.outputFilePath)

  return await bundler.build({
    getTypeDefs: () => {
      const builder = new SchemaBuilder(
        path.join(process.cwd(), options.sfiFilePath)
      )

      const built = builder.build()

      const typeDefs = built.typeDefs

      return typeDefs
    },
    watch: options.watch,
    onWatch: options.onWatch
  })
}
