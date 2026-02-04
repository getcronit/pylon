import ts from 'typescript'
import {SchemaParser} from '../schema-parser'
import path from 'path'

export function buildTestSchema(code: string) {
  const fileName = 'index.ts'
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true
  )

  const host = ts.createCompilerHost({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext
  })

  const originalGetSourceFile = host.getSourceFile
  host.getSourceFile = (
    name,
    languageVersion,
    onError,
    shouldCreateNewSourceFile
  ) => {
    if (name === fileName || name === './index.ts') return sourceFile
    return originalGetSourceFile(
      name,
      languageVersion,
      onError,
      shouldCreateNewSourceFile
    )
  }

  const program = ts.createProgram(
    [fileName],
    {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true
    },
    host
  )

  const checker = program.getTypeChecker()

  const fileSymbol = checker.getSymbolAtLocation(sourceFile)!
  const exports = checker.getExportsOfModule(fileSymbol)
  const graphqlExport = exports.find(e => e.escapedName === 'graphql')

  if (!graphqlExport) {
    throw new Error('Could not find graphql export in test code')
  }

  const graphqlType = checker.getTypeOfSymbolAtLocation(
    graphqlExport,
    sourceFile
  )

  const queryProperty = graphqlType.getProperty('Query')
  const mutationProperty = graphqlType.getProperty('Mutation')
  const subscriptionProperty = graphqlType.getProperty('Subscription')

  const queryType = queryProperty
    ? checker.getTypeOfSymbolAtLocation(queryProperty, sourceFile)
    : undefined
  const mutationType = mutationProperty
    ? checker.getTypeOfSymbolAtLocation(mutationProperty, sourceFile)
    : undefined
  const subscriptionType = subscriptionProperty
    ? checker.getTypeOfSymbolAtLocation(subscriptionProperty, sourceFile)
    : undefined

  const parser = new SchemaParser(checker, sourceFile, program)
  parser.parse({
    Query: queryType,
    Mutation: mutationType,
    Subscription: subscriptionType
  })

  const resolvers = parser.getResolvers()
  const serializableResolvers = Object.fromEntries(
    Object.entries(resolvers).map(([typeName, resolver]) => [
      typeName,
      {
        __resolveType: (resolver as any).__resolveType?.toString()
      }
    ])
  )

  return {
    typeDefs: parser.toString(),
    resolvers: serializableResolvers
  }
}
