import path from 'path'
import {loadOrmContribution} from '../orm-bridge.js'
import {Bundler} from './bundler/bundler.js'
import {SchemaBuilder} from './schema/builder.js'

export interface BuildOptions {
  sfiFilePath: string
  outputFilePath: string
  onBuild?: (output: {
    totalFiles: number
    totalSize: number
    schemaChanged: boolean
    duration: number
  }) => void
  skipInitialBuild?: boolean
}

export {SchemaBuilder}

export const build = async (options: BuildOptions) => {
  const cwd = process.cwd()

  // If the project uses the ORM, load its entity IR ONCE (by executing the
  // models) and merge it authoritatively into the schema. `undefined` when the
  // project has no ORM — then the build is exactly as before. Loaded here (not
  // per-rebuild) to avoid re-running the models inside the bundler hot loop.
  const contributeIR = await loadOrmContribution(cwd, options.sfiFilePath)

  const bundler = new Bundler(options.sfiFilePath, options.outputFilePath)

  return await bundler.build({
    getBuildDefs: () => {
      const builder = new SchemaBuilder(path.join(cwd, options.sfiFilePath))

      const built = builder.build({contributeIR})

      return {
        typeDefs: built.typeDefs,
        resolvers: built.resolvers
      }
    },
    onBuild: options.onBuild,
    skipInitialBuild: options.skipInitialBuild
  })
}
