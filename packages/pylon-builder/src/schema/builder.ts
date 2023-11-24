import ts from 'typescript'
import {SchemaParser} from './schema-parser'

export class SchemaBuilder {
  private program: ts.Program
  private checker: ts.TypeChecker
  private sfiFile!: ts.SourceFile
  private sfi!: ts.Symbol

  constructor(sfiFilePath: string) {
    this.program = ts.createProgram([sfiFilePath], {
      strictNullChecks: true
    })

    this.checker = this.program.getTypeChecker()

    this.loadSfi()
  }

  private loadSfi() {
    const sourceFiles = this.program.getSourceFiles()
    const file = sourceFiles.find(file => file.fileName.endsWith('index.ts'))

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
