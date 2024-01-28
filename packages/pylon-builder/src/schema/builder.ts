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
    this.sfiFilePath = path.join(process.cwd(), sfiFilePath)

    this.program = ts.createProgram([this.sfiFilePath], {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: false,
      forceConsistentCasingInFileNames: true,
      noImplicitAny: true,
      experimentalDecorators: true
    })

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
      exportSymbol => exportSymbol.escapedName === 'default'
    )

    if (!sfiFileDefaultExport) {
      throw new Error('Could not find default export')
    }

    this.sfi = sfiFileDefaultExport
  }

  public build() {
    const sfiType = this.checker.getTypeOfSymbolAtLocation(
      this.sfi,
      this.sfiFile
    )

    const plainResolversProperty = sfiType.getProperty('plainResolvers')

    if (!plainResolversProperty) {
      throw new Error('Could not find plainResolvers property')
    }

    const plainResolversType = this.checker.getTypeOfSymbolAtLocation(
      plainResolversProperty,
      this.sfiFile
    )

    const queryProperty = plainResolversType.getProperty('Query')
    const mutationProperty = plainResolversType.getProperty('Mutation')

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
