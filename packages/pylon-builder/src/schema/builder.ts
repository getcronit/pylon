import ts from 'typescript'
import {SchemaParser} from './schema-parser'
import path from 'path'

export class SchemaBuilder {
  private program: ts.Program
  private checker: ts.TypeChecker
  private sfiFile!: ts.SourceFile
  private sfi!: ts.Symbol
  private sfiFilePath: string

  constructor(sfiFilePath: string) {
    this.sfiFilePath = sfiFilePath

    const tsConfigOptions = this.loadTsConfigOptions()

    this.program = ts.createProgram([this.sfiFilePath], tsConfigOptions)

    this.checker = this.program.getTypeChecker()

    this.loadSfi()
  }

  private loadSfi() {
    const sourceFiles = this.program.getSourceFiles()
    const file = sourceFiles.find(file => file.fileName === this.sfiFilePath)

    if (!file) {
      throw new Error('Could not find index.ts (pylon entrypoint)')
    }

    this.sfiFile = file

    const sfiFileSymbol = this.checker.getSymbolAtLocation(file)!
    const sfiFileExports = this.checker.getExportsOfModule(sfiFileSymbol!)
    const sfiFileDefaultExport = sfiFileExports.find(
      exportSymbol => exportSymbol.escapedName === 'graphql'
    )

    if (!sfiFileDefaultExport) {
      throw new Error('Could not find graphql export')
    }

    this.sfi = sfiFileDefaultExport
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

  public build() {
    const sfiType = this.checker.getTypeOfSymbolAtLocation(
      this.sfi,
      this.sfiFile
    )

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

    const queryType = queryProperty
      ? this.checker.getTypeOfSymbolAtLocation(queryProperty, this.sfiFile)
      : undefined
    const mutationType = mutationProperty
      ? this.checker.getTypeOfSymbolAtLocation(mutationProperty, this.sfiFile)
      : undefined

    const parser = new SchemaParser(this.checker, this.sfiFile)

    parser.parse({
      Query: queryType,
      Mutation: mutationType
    })

    return {
      typeDefs: parser.toString(),
      schema: parser.getSchema()
    }
  }
}
