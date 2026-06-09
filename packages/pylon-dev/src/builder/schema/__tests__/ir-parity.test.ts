/**
 * Parity: `toSDL(parser.toIR())` must reproduce the same GraphQL as the
 * long-standing `parser.toString()` for the slice the IR models — object types,
 * root operations (with args), interfaces and enums. Comparison is done on the
 * parsed GraphQL AST, so whitespace and declaration order are irrelevant.
 *
 * This proves the GraphQL builder can emit the shared IR without behaviour
 * change, the foundation for eventually having Pylon and the ORM read ONE IR.
 * Unions and input objects are out of the IR's current scope and excluded.
 */
import {Kind, parse, print} from 'graphql'
import ts from 'typescript'
import {toSDL} from '@getcronit/pylon-ir'
import {describe, expect, it} from 'vitest'
import {SchemaParser} from '../schema-parser'

function buildBoth(code: string) {
  const fileName = 'index.ts'
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true)
  const host = ts.createCompilerHost({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext
  })
  const orig = host.getSourceFile
  host.getSourceFile = (name, lv, oe, sc) =>
    name === fileName || name === './index.ts'
      ? sourceFile
      : orig(name, lv, oe, sc)
  const program = ts.createProgram(
    [fileName],
    {target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, strict: true, esModuleInterop: true, skipLibCheck: true},
    host
  )
  const checker = program.getTypeChecker()
  const fileSymbol = checker.getSymbolAtLocation(sourceFile)!
  const graphqlExport = checker
    .getExportsOfModule(fileSymbol)
    .find(e => e.escapedName === 'graphql')!
  const graphqlType = checker.getTypeOfSymbolAtLocation(graphqlExport, sourceFile)
  const get = (n: string) => {
    const p = graphqlType.getProperty(n)
    return p ? checker.getTypeOfSymbolAtLocation(p, sourceFile) : undefined
  }
  const parser = new SchemaParser(checker, sourceFile, program)
  parser.parse({Query: get('Query'), Mutation: get('Mutation'), Subscription: get('Subscription')})
  return {toStringSDL: parser.toString(), irSDL: toSDL(parser.toIR())}
}

interface Maps {
  objects: Record<string, Record<string, string>>
  interfaces: Record<string, Record<string, string>>
  enums: Record<string, string[]>
}

function maps(sdl: string): Maps {
  const doc = parse(sdl)
  const out: Maps = {objects: {}, interfaces: {}, enums: {}}
  for (const def of doc.definitions) {
    if (
      def.kind === Kind.OBJECT_TYPE_DEFINITION ||
      def.kind === Kind.INTERFACE_TYPE_DEFINITION
    ) {
      const fields: Record<string, string> = {}
      for (const f of def.fields ?? []) {
        const args = (f.arguments ?? [])
          .map(a => `${a.name.value}: ${print(a.type)}`)
          .join(', ')
        fields[f.name.value] = `${args ? `(${args})` : ''}: ${print(f.type)}`
      }
      const bucket = def.kind === Kind.OBJECT_TYPE_DEFINITION ? out.objects : out.interfaces
      bucket[def.name.value] = fields
    } else if (def.kind === Kind.ENUM_TYPE_DEFINITION) {
      out.enums[def.name.value] = (def.values ?? []).map(v => v.name.value).sort()
    }
  }
  return out
}

/** Assert the IR reproduces every object/interface/enum that `toString` emits. */
function expectParity(code: string) {
  const {toStringSDL, irSDL} = buildBoth(code)
  const a = maps(toStringSDL)
  const b = maps(irSDL)
  for (const [name, fields] of Object.entries(a.objects)) {
    expect(b.objects[name], `object ${name}`).toEqual(fields)
  }
  for (const [name, fields] of Object.entries(a.interfaces)) {
    expect(b.interfaces[name], `interface ${name}`).toEqual(fields)
  }
  for (const [name, values] of Object.entries(a.enums)) {
    expect(b.enums[name], `enum ${name}`).toEqual(values)
  }
}

describe('IR ↔ toString parity (object/operation/interface/enum slice)', () => {
  it('primitives, lists and nullability', () => {
    expectParity(`
      export const graphql = {
        Query: {
          str: () => "a",
          num: () => 1,
          bool: () => true,
          list: () => ["a", "b"],
          nullable: () => null as string | null,
          withArg: (args: {id: string}) => args.id
        }
      }
    `)
  })

  it('a nested object graph (the ORM-shaped User/Post case)', () => {
    expectParity(`
      class Post { id!: number; title!: string; author!: User }
      class User { id!: number; email!: string; posts!: Post[] }
      export const graphql = {
        Query: {
          user: (args: {id: string}): User => ({} as User),
          users: (): User[] => []
        }
      }
    `)
  })

  it('enums (string-literal unions)', () => {
    expectParity(`
      type Role = "ADMIN" | "USER"
      class Account { id!: number; role!: Role }
      export const graphql = {
        Query: { account: (): Account => ({} as Account) }
      }
    `)
  })

  it('class inheritance (interface derivation)', () => {
    expectParity(`
      class Node { id!: number }
      class User extends Node { email!: string }
      class Post extends Node { title!: string }
      export const graphql = {
        Query: {
          user: (): User => ({} as User),
          post: (): Post => ({} as Post)
        }
      }
    `)
  })
})
