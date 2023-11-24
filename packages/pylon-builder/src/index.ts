import fs from 'fs'
import path from 'path'

import {Bundler} from './bundler/bundler.js'
import {SchemaBuilder} from './schema/builder.js'

export interface BuildOptions {
  sfiFilePath: string
  outputFilePath: string
  watch?: boolean
  onWatch?: () => void
  withClient?: boolean
}

export const build = async (options: BuildOptions) => {
  const bundler = new Bundler(options.sfiFilePath, options.outputFilePath)

  await bundler.build({
    getTypeDefs: () => {
      const builder = new SchemaBuilder(options.sfiFilePath)

      const built = builder.build()

      // Write typedefs to file (only for debugging purposes)
      const typeDefs = built.typeDefs
      const folder = path.dirname(options.outputFilePath)

      // Create folder if it doesn't exist
      fs.mkdirSync(folder, {recursive: true})

      fs.writeFileSync(path.join(folder, 'schema.graphql'), typeDefs)

      return typeDefs
    },
    watch: options.watch,
    onWatch: options.onWatch
  })
}
