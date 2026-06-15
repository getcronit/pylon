import ts from 'typescript'
import {mergeIR, pruneUnreferencedEnums, toSDL, type PylonIR} from '@getcronit/pylon-ir'
import {SchemaParser} from './schema-parser'
import path from 'path'

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

    const tsConfigOptions = this.loadTsConfigOptions()

    const filesInSfiDir = ts.sys
      .readDirectory(path.dirname(this.sfiFilePath), ['.ts'], ['.d.ts'])
      .concat([path.join(path.dirname(this.sfiFilePath), '..', 'pylon.d.ts')])

    this.program = ts.createProgram(filesInSfiDir, tsConfigOptions)

    this.checker = this.program.getTypeChecker()

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

    return parsedConfig.options
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

    // Default path (no contribution) is byte-for-byte unchanged. With an
    // authoritative contribution we render the schema from the merged IR.
    const ir = options.contributeIR
      ? pruneUnreferencedEnums(mergeIR(parser.toIR(), options.contributeIR))
      : undefined

    return {
      typeDefs: ir ? toSDL(ir) : parser.toString(),
      schema: parser.getSchema(),
      resolvers: parser.getResolvers(),
      ir
    }
  }
}
