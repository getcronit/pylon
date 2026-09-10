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
import {parse, print} from 'graphql'
import ts from 'typescript'
import {toSDL} from '@/ir'
import {describe, expect, it} from 'vitest'
import {SchemaParser} from '@/cli/builder/schema/schema-parser'

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

/**
 * Normalize an SDL to a canonical, order-independent form: parse, sort the
 * definitions, and re-print each through graphql-js. Two SDLs that normalize
 * equal are fully equivalent — same types, fields, args, descriptions, unions,
 * enums, scalars — regardless of whitespace or declaration order.
 */
function normalize(sdl: string): string {
  const doc = parse(sdl)
  const defKey = (d: (typeof doc.definitions)[number]) =>
    `${d.kind}:${'name' in d && d.name ? d.name.value : ''}`
  return [...doc.definitions]
    .sort((a, b) => defKey(a).localeCompare(defKey(b)))
    .map(d => print(d))
    .join('\n\n')
}

/** Assert `toSDL(toIR())` is fully graphql-equivalent to `toString()`. */
function expectParity(code: string) {
  const {toStringSDL, irSDL} = buildBoth(code)
  expect(normalize(irSDL)).toBe(normalize(toStringSDL))
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

  it('input objects (nested argument shapes)', () => {
    expectParity(`
      class User { id!: number; name!: string }
      export const graphql = {
        Query: { user: (id: string): User => ({} as User) },
        Mutation: {
          createUser: (input: { name: string; age?: number }): User => ({} as User)
        }
      }
    `)
  })

  it('unions of objects', () => {
    expectParity(`
      type A = { a: string }
      type B = { b: number }
      type Result = A | B
      export const graphql = {
        Query: { result: (): Result => ({ a: "x" }) }
      }
    `)
  })

  it('Connection/Edge generics (transformed type names)', () => {
    expectParity(`
      interface Edge<T> { node: T; cursor: string }
      interface Connection<T> { edges: Edge<T>[]; pageInfo: PageInfo }
      interface PageInfo { hasNextPage: boolean; endCursor: string }
      type User = { id: string; name: string }
      export const graphql = {
        Query: { users: (): Connection<User> => ({ edges: [], pageInfo: {} as PageInfo }) }
      }
    `)
  })

  it('__typename literal override', () => {
    expectParity(`
      class Dog { __typename = "Animal" as const; name!: string }
      export const graphql = {
        Query: { dog: (): Dog => ({} as Dog) }
      }
    `)
  })

  it('JSDoc descriptions (type, field, and resolver)', () => {
    expectParity(`
      /** A user in the system */
      class User {
        /** The unique identifier */
        id!: string
        name!: string
      }
      export const graphql = {
        Query: {
          /** Fetches a user by ID */
          user: (id: string): User => ({} as User)
        }
      }
    `)
  })
})
