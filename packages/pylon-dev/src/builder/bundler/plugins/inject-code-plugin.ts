import {Plugin} from 'esbuild'
import path from 'path'
import fs from 'fs/promises'
import {updateFileIfChanged} from '../../update-file-if-changed'

export interface InjectCodePluginOptions {
  getBuildDefs: () => {
    typeDefs: string
    resolvers: Record<
      string,
      {
        __resolveType?: (obj: any) => string
      }
    >
  }
  outputDir: string
}

export const injectCodePlugin = ({
  getBuildDefs,
  outputDir
}: InjectCodePluginOptions): Plugin => ({
  name: 'inject-code',
  setup(build) {
    build.onLoad(
      {filter: /src[\/\\]index\.ts$/, namespace: 'file'},
      async args => {
        // Convert to relative path to ensure we match `src/index.ts` at root
        const relativePath = path.relative(process.cwd(), args.path)

        if (relativePath !== path.join('src', 'index.ts')) {
          return
        }

        const {typeDefs, resolvers} = getBuildDefs()

        const preparedResolvers = prepareObjectInjection(resolvers)

        const contents = await fs.readFile(args.path, 'utf-8')

        // Write the typeDefs to a file
        const typeDefsPath = path.join(
          process.cwd(),
          outputDir,
          'schema.graphql'
        )

        await updateFileIfChanged(typeDefsPath, typeDefs)

        // Write base resolvers to a file

        const resolversPath = path.join(
          process.cwd(),
          outputDir,
          'resolvers.js'
        )

        await updateFileIfChanged(
          resolversPath,
          `export const resolvers = ${preparedResolvers}`
        )

        return {
          loader: 'ts',
          contents:
            `import {executeConfig} from "@getcronit/pylon"
          
            const __internalPylonConfig = await import(".pylon/config.js")
            executeConfig(__internalPylonConfig.config)

            
` +
            contents +
            `
  import {handler as __internalPylonHandler} from "@getcronit/pylon"

  app.use(__internalPylonHandler({
    typeDefs: ${JSON.stringify(typeDefs)},
    graphql,
    resolvers: ${preparedResolvers},
  }))
  `
        }
      }
    )
  }
})

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
