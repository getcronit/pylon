import ts from 'typescript'
import {parse, print} from 'graphql'
import {expect} from 'vitest'
import {toSDL} from '../../../../ir'
import {SchemaParser} from '../schema-parser'
import path from 'path'

/** Canonical, order-independent SDL form for equivalence comparison. */
function normalizeSDL(sdl: string): string {
  const doc = parse(sdl)
  const key = (d: (typeof doc.definitions)[number]) =>
    `${d.kind}:${'name' in d && d.name ? d.name.value : ''}`
  return [...doc.definitions]
    .sort((a, b) => key(a).localeCompare(key(b)))
    .map(d => print(d))
    .join('\n\n')
}

/**
 * Compile `code` in-memory and return a parsed `SchemaParser`. Shared by the
 * snapshot harness and the characterization suite so tests can inspect any
 * output surface (toString / toIR / getResolvers) from one parse.
 */
export function buildParser(code: string): SchemaParser {
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
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (name === fileName || name === './index.ts') return sourceFile
    return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
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
  const fileSymbol = checker.getSymbolAtLocation(program.getSourceFile(fileName)!)!
  const exports = checker.getExportsOfModule(fileSymbol)
  const graphqlExport = exports.find(e => e.escapedName === 'graphql')

  if (!graphqlExport) {
    throw new Error('Could not find graphql export in test code')
  }

  const sf = program.getSourceFile(fileName)!
  const graphqlType = checker.getTypeOfSymbolAtLocation(graphqlExport, sf)
  const get = (name: string) => {
    const prop = graphqlType.getProperty(name)
    return prop ? checker.getTypeOfSymbolAtLocation(prop, sf) : undefined
  }

  const parser = new SchemaParser(checker, sf, program)
  parser.parse({
    Query: get('Query'),
    Mutation: get('Mutation'),
    Subscription: get('Subscription')
  })
  return parser
}

export function buildTestSchema(code: string) {
  const parser = buildParser(code)
  const typeDefs = parser.toString()

  // IR-first gate: `toSDL(toIR())` must be fully graphql-equivalent to
  // `toString()` for EVERY snapshot case. This turns the whole existing corpus
  // into IR-parity verification — the safety proof for swapping the renderer.
  expect(
    normalizeSDL(toSDL(parser.toIR())),
    'toSDL(toIR()) must equal toString()'
  ).toBe(normalizeSDL(typeDefs))

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
    typeDefs,
    resolvers: serializableResolvers
  }
}
