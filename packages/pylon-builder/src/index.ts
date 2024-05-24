import {Bundler} from './bundler/bundler.js'
import {SchemaBuilder} from './schema/builder.js'

export interface BuildOptions {
  sfiFilePath: string
  outputFilePath: string
  watch?: boolean
  onWatch?: () => void
}

export const build = async (options: BuildOptions) => {
  const bundler = new Bundler(options.sfiFilePath, options.outputFilePath)

  await bundler.build({
    getTypeDefs: () => {
      const builder = new SchemaBuilder(options.sfiFilePath)

      const built = builder.build()

      // Write typedefs to file (only for debugging purposes)
      const typeDefs = built.typeDefs

      return typeDefs
    },
    watch: options.watch,
    onWatch: options.onWatch
  })
}
