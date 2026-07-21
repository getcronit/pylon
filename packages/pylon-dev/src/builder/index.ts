import fs from 'node:fs'
import path from 'path'
import {introspectViaRunner} from '../project-bridge.js'
import {Bundler, type BuildMode} from './bundler/bundler.js'
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
  /** dev = run `src/**` live via the loader; build = transpile to `.pylon/**`. Default 'dev'. */
  mode?: BuildMode
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
  // A project with no ORM legitimately has no contribution. But if the ORM IS present and
  // its introspection THROWS (e.g. a model module fails to load), silently dropping it
  // yields a subtly-wrong analyzer-only schema (STI interfaces don't collapse, etc.). Warn
  // loudly so the real cause is visible instead of surfacing downstream as odd type errors.
  const contributeIR = await introspectViaRunner(cwd, options.sfiFilePath).catch((e) => {
    console.warn(
      `[pylon] ORM introspection failed — building schema WITHOUT the ORM contribution. ` +
        `This usually means a model module failed to load:\n${e?.stack ?? e}`
    )
    return undefined
  })

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
    mode: options.mode,
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
