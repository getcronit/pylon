import path from 'path'
import {loadOrmContribution} from '../orm-bridge.js'
import {Bundler} from './bundler/bundler.js'
import {SchemaBuilder} from './schema/builder.js'

export interface BuildOptions {
  sfiFilePath: string
  outputFilePath: string
}

export {SchemaBuilder}

/**
 * Prepare the build. Returns the bundler controls (`buildServer`/`buildPages`/
 * `dispose`/`cancel`); the CALLER drives the ordered sequence (server → gqty
 * client → pages → serve). See Bundler for why the ordering matters.
 */
export const build = async (options: BuildOptions) => {
  const cwd = process.cwd()

  // If the project uses the ORM, load its entity IR ONCE (by executing the
  // models) and merge it authoritatively into the schema. `undefined` when the
  // project has no ORM. Loaded here (not per-rebuild) to avoid re-running the
  // models inside the bundler hot loop.
  const contributeIR = await loadOrmContribution(cwd, options.sfiFilePath)

  const bundler = new Bundler(options.sfiFilePath, options.outputFilePath)

  return await bundler.build({
    getBuildDefs: () => {
      const builder = new SchemaBuilder(path.join(cwd, options.sfiFilePath))
      const built = builder.build({contributeIR})
      return {typeDefs: built.typeDefs, resolvers: built.resolvers}
    }
  })
}
