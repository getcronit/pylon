import ts from 'typescript'
import fs from 'node:fs'
import {mergeIR, pruneUnreferencedEnums, toSDL, type PylonIR} from '@getcronit/pylon-ir'
import {SchemaParser} from './schema-parser'
import path from 'path'

/**
 * Persistent TS state per entry so dev rebuilds REUSE the expensive work instead of
 * starting from scratch: a caching compiler host (keeps parsed SourceFiles — crucially
 * the huge lib.d.ts + node_modules type files that never change), the prior program
 * (structural reuse → the checker skips re-checking unchanged files), and the parsed
 * options object (oldProgram reuse requires stable options). The outer schema cache
 * (builder/index.ts) means this only runs when a source file actually changed; here we
 * make that re-introspection incremental. (A tsconfig edit isn't picked up until a dev
 * restart — config changes are rare and usually warrant one.)
 */
const tsState = new Map<
  string,
  {host: ts.CompilerHost; program: ts.Program; options: ts.CompilerOptions}
>()

function createCachingHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options)
  const cache = new Map<string, {mtime: number; file: ts.SourceFile | undefined}>()
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, langVersion, onError, shouldCreate) => {
    let mtime = -1
    try {
      mtime = fs.statSync(fileName).mtimeMs
    } catch {
      /* missing — let the real host report it */
    }
    const hit = cache.get(fileName)
    if (hit && hit.mtime === mtime) return hit.file
    const file = getSourceFile(fileName, langVersion, onError, shouldCreate)
    cache.set(fileName, {mtime, file})
    return file
  }
  return host
}

export interface BuildOptions {
  /**
   * An authoritative IR contribution (e.g. the ORM's entities) merged OVER what
   * the type-checker introspects. Where it overlaps by name it wins — so entity
   * types reflect the ORM's intent (precise scalars, hidden columns, relation
   * list-ness) instead of being re-derived from the resolver types. When given,
   * the returned `typeDefs` are rendered from the merged IR.
   */
  contributeIR?: PylonIR
}

export class SchemaBuilder {
  private program: ts.Program
  private checker: ts.TypeChecker
  private sfiFile!: ts.SourceFile
  private sfi!: ts.Symbol
  private sfiFilePath: string

  constructor(sfiFilePath: string) {
    this.sfiFilePath = sfiFilePath

    const filesInSfiDir = ts.sys
      .readDirectory(path.dirname(this.sfiFilePath), ['.ts'], ['.d.ts'])
      .concat([path.join(path.dirname(this.sfiFilePath), '..', 'pylon.d.ts')])

    // Reuse the prior build's host/options/program for this entry (see tsState):
    // unchanged files (esp. lib + deps) skip re-parsing, and the checker reuses
    // their type info — making a re-introspection after a source edit incremental.
    const prev = tsState.get(this.sfiFilePath)
    const tsConfigOptions = prev?.options ?? this.loadTsConfigOptions()
    const host = prev?.host ?? createCachingHost(tsConfigOptions)

    this.program = ts.createProgram(
      filesInSfiDir,
      tsConfigOptions,
      host,
      prev?.program
    )
    this.checker = this.program.getTypeChecker()

    tsState.set(this.sfiFilePath, {host, program: this.program, options: tsConfigOptions})

    this.loadSfi()
  }

  private loadSfi() {
    const sourceFiles = this.program.getSourceFiles()

    const file = sourceFiles.find(
      file => path.resolve(file.fileName) === this.sfiFilePath
    )

    if (!file) {
      throw new Error('Could not find index.ts (pylon entrypoint)')
    }

    this.sfiFile = file

    const sfiFileSymbol = this.checker.getSymbolAtLocation(file)!
    const sfiFileExports = this.checker.getExportsOfModule(sfiFileSymbol!)

    // The entry MUST default-export the Pylon app (`export default new Pylon()...`).
    // `build()` reads its `.graphql` property type. This is the single source of
    // truth — the app carries both the typed surface (build) and the resolvers
    // (run). (Breaking: the legacy named `export const graphql` is gone.)
    const def = sfiFileExports.find(s => s.escapedName === 'default')
    if (!def) {
      throw new Error(
        'Pylon entry must `export default` the app (e.g. `export default new Pylon(...)`).'
      )
    }

    this.sfi = def
  }

  private loadTsConfigOptions() {
    const defaultOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: false,
      forceConsistentCasingInFileNames: true,
      noImplicitAny: true,
      experimentalDecorators: true
    }

    // Find the tsconfig.json file
    const configPath = ts.findConfigFile(
      path.dirname(this.sfiFilePath), // Directory to start searching from
      ts.sys.fileExists, // Function to check if a file exists
      'tsconfig.json' // File name to search for
    )

    if (!configPath) {
      console.log('Could not find tsconfig.json')
      return defaultOptions
    }

    // Read the tsconfig.json file
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

    if (configFile.error) {
      console.log('Could not read tsconfig.json', configFile.error)
      return defaultOptions
    }

    // Parse the tsconfig.json file
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    )

    // FORCE strictNullChecks for introspection regardless of the user's tsconfig.
    // Nullability is schema-significant: a resolver returning `T | null` MUST emit a
    // nullable field. Without strictNullChecks, TypeScript collapses `T | null` into
    // `T`, so a non-strict project would silently get NON-null fields (and `pull`
    // would propagate the wrong nullability downstream). The build only READS types
    // for schema derivation — it never reports typecheck errors to the user — so
    // forcing this is safe and only makes the derived schema accurate.
    return {...parsedConfig.options, strictNullChecks: true}
  }

  public build(options: BuildOptions = {}) {
    let sfiType = this.checker.getTypeOfSymbolAtLocation(this.sfi, this.sfiFile)

    // If `this.sfi` is a default-exported Pylon app (not a bare resolver object),
    // it has no Query/Mutation/Subscription of its own — dig into its `.graphql`
    // property, which carries the (instantiated) merged resolver type.
    const hasRootOp =
      sfiType.getProperty('Query') ||
      sfiType.getProperty('Mutation') ||
      sfiType.getProperty('Subscription')
    if (!hasRootOp) {
      // INSTANTIATED property type (substitutes the class generic `G`) — NOT
      // `getTypeOfSymbolAtLocation`, which resolves the property's *declared* type
      // (the bare `G`, i.e. its constraint with no concrete fields).
      const gType = (this.checker as any).getTypeOfPropertyOfType?.(
        sfiType,
        'graphql'
      )
      if (gType) sfiType = gType
    }

    // const plainResolversProperty = sfiType.getProperty('plainResolvers')

    // if (!plainResolversProperty) {
    //   throw new Error('Could not find plainResolvers property')
    // }

    // const plainResolversType = this.checker.getTypeOfSymbolAtLocation(
    //   plainResolversProperty,
    //   this.sfiFile
    // )

    const queryProperty = sfiType.getProperty('Query')
    const mutationProperty = sfiType.getProperty('Mutation')
    const subscriptionProperty = sfiType.getProperty('Subscription')

    const queryType = queryProperty
      ? this.checker.getTypeOfSymbolAtLocation(queryProperty, this.sfiFile)
      : undefined
    const mutationType = mutationProperty
      ? this.checker.getTypeOfSymbolAtLocation(mutationProperty, this.sfiFile)
      : undefined
    const subscriptionType = subscriptionProperty
      ? this.checker.getTypeOfSymbolAtLocation(
          subscriptionProperty,
          this.sfiFile
        )
      : undefined

    const parser = new SchemaParser(this.checker, this.sfiFile, this.program)

    parser.parse({
      Query: queryType,
      Mutation: mutationType,
      Subscription: subscriptionType
    })

    // The IR is ALWAYS produced (it's the projection boundary). With an authoritative
    // ORM contribution it's merged (entity types win on overlap) and the SDL is
    // rendered from it; without one the default SDL path stays byte-for-byte unchanged
    // (`parser.toString()`), but `ir` is still returned so `pylon inspect` can serialize
    // the model whether or not the project uses the ORM.
    const base = parser.toIR()
    const ir = options.contributeIR
      ? pruneUnreferencedEnums(mergeIR(base, options.contributeIR))
      : base

    return {
      typeDefs: options.contributeIR ? toSDL(ir) : parser.toString(),
      schema: parser.getSchema(),
      resolvers: parser.getResolvers(),
      ir
    }
  }

  /**
   * The real source files the type program depends on (excluding lib + deps) —
   * the entry plus everything it transitively imports. The dev build hashes these
   * to cache the (expensive ~1s+) schema derivation and skip it when none changed.
   */
  public getSourceFiles(): string[] {
    return this.program
      .getSourceFiles()
      .map(f => f.fileName)
      .filter(n => !n.includes('/node_modules/') && !n.endsWith('.d.ts'))
  }
}
