import fs from 'node:fs'
import path from 'path'
import {loadAppContribution} from '../project-bridge.js'
import {Bundler} from './bundler/bundler.js'
import {SchemaBuilder} from './schema/builder.js'

/**
 * Cheap fingerprint of a set of files (mtime + size). Editors bump mtime on save,
 * so this reliably changes when content does, without reading every file.
 */
const fingerprint = (files: string[]): string =>
  files
    .slice()
    .sort()
    .map(f => {
      try {
        const s = fs.statSync(f)
        return `${f}:${s.mtimeMs}:${s.size}`
      } catch {
        return `${f}:0:0`
      }
    })
    .join('|')

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
  const contributeIR = await loadAppContribution(cwd, options.sfiFilePath)

  const bundler = new Bundler(options.sfiFilePath, options.outputFilePath)

  // The schema derivation (ts.createProgram + type-introspection) is the dominant
  // backend cost (~1s+ on a real app), and the bundler re-invokes getBuildDefs on
  // EVERY rebuild — even when the change was a page/component, where the schema can't
  // have changed. Cache it, keyed by the type program's REAL source files (entry +
  // everything it transitively imports, surfaced via getSourceFiles), and skip the
  // rebuild when none of them changed. The fingerprint is recomputed from the prior
  // build's file set, so a newly-added import invalidates correctly (the edited
  // file's stamp changes) and the set self-heals on the next miss.
  let cache:
    | {files: string[]; fp: string; defs: {typeDefs: string; resolvers: any}}
    | undefined

  return await bundler.build({
    getBuildDefs: () => {
      if (cache && fingerprint(cache.files) === cache.fp) {
        return cache.defs
      }
      const builder = new SchemaBuilder(path.join(cwd, options.sfiFilePath))
      const built = builder.build({contributeIR})
      const defs = {typeDefs: built.typeDefs, resolvers: built.resolvers}
      const files = builder.getSourceFiles()
      cache = {files, fp: fingerprint(files), defs}
      return defs
    }
  })
}
