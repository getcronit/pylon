/**
 * Feature-coverage integration: for each basic GraphQL feature, build the schema
 * through the real parse → IR → SDL pipeline, then parse the SDL into an actual
 * `GraphQLSchema` and make EXPLICIT assertions on the resulting types/fields.
 *
 * Complements the snapshot tests (which freeze output) with readable, intent-
 * level guarantees — and `buildSchema` validates the document, so a feature that
 * produces invalid SDL fails here rather than silently snapshotting garbage.
 */
import {
  buildSchema,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLUnionType,
  type GraphQLSchema
} from 'graphql'
import {describe, expect, it} from 'vitest'
import {buildTestSchema} from './test-utils'

function schemaFor(code: string): GraphQLSchema {
  return buildSchema(buildTestSchema(code).typeDefs)
}

/** Stringified GraphQL type of `Type.field`, e.g. "String!", "[Post!]!". */
function ft(schema: GraphQLSchema, typeName: string, fieldName: string): string {
  const t = schema.getType(typeName)
  expect(t, `type ${typeName}`).toBeDefined()
  const fields = (t as GraphQLObjectType | GraphQLInputObjectType).getFields()
  expect(fields[fieldName], `${typeName}.${fieldName}`).toBeDefined()
  return String(fields[fieldName].type)
}

describe('GraphQL features — scalars', () => {
  const schema = schemaFor(`
    export const graphql = {
      Query: {
        str: (): string => "a",
        num: (): number => 1,
        bool: (): boolean => true,
        date: (): Date => new Date()
      }
    }
  `)

  it('maps primitives to GraphQL scalars (non-null by default)', () => {
    expect(ft(schema, 'Query', 'str')).toBe('String!')
    expect(ft(schema, 'Query', 'num')).toBe('Number!')
    expect(ft(schema, 'Query', 'bool')).toBe('Boolean!')
    expect(ft(schema, 'Query', 'date')).toBe('Date!')
  })
})

describe('GraphQL features — nullability', () => {
  const schema = schemaFor(`
    class T { req!: string; opt?: string; orNull!: string | null }
    export const graphql = { Query: { t: (): T => ({} as T) } }
  `)

  it('required vs optional vs null-union', () => {
    expect(ft(schema, 'T', 'req')).toBe('String!')
    expect(ft(schema, 'T', 'opt')).toBe('String')
    expect(ft(schema, 'T', 'orNull')).toBe('String')
  })
})

describe('GraphQL features — lists', () => {
  const schema = schemaFor(`
    class Item { id!: number }
    class T {
      scalars!: string[]
      items!: Item[]
      listOrNull!: string[] | null
      nullableItems!: (string | null)[]
    }
    export const graphql = { Query: { t: (): T => ({} as T) } }
  `)

  it('scalar, object and nullable lists', () => {
    expect(ft(schema, 'T', 'scalars')).toBe('[String!]!')
    expect(ft(schema, 'T', 'items')).toBe('[Item!]!')
    expect(ft(schema, 'T', 'listOrNull')).toBe('[String!]')
    expect(ft(schema, 'T', 'nullableItems')).toBe('[String]!')
  })

  it('nested lists preserve their depth', () => {
    const nested = schemaFor(`
      class T { matrix!: number[][]; cube!: string[][][] }
      export const graphql = { Query: { t: (): T => ({} as T) } }
    `)
    expect(ft(nested, 'T', 'matrix')).toBe('[[Number!]!]!')
    expect(ft(nested, 'T', 'cube')).toBe('[[[String!]!]!]!')
  })
})

describe('GraphQL features — resolver args & inputs', () => {
  it('positional scalar args', () => {
    const schema = schemaFor(`
      export const graphql = { Query: { greet: (name: string, times: number): string => name } }
    `)
    const args = (schema.getType('Query') as GraphQLObjectType).getFields().greet.args
    const byName = Object.fromEntries(args.map(a => [a.name, String(a.type)]))
    expect(byName).toEqual({name: 'String!', times: 'Number!'})
    expect(ft(schema, 'Query', 'greet')).toBe('String!')
  })

  it('object arg becomes an input type', () => {
    const schema = schemaFor(`
      class User { id!: number }
      export const graphql = {
        Mutation: { createUser: (input: { name: string; age?: number }): User => ({} as User) }
      }
    `)
    const input = schema.getType('CreateUserInput') ?? schema.getType('UserInput')
    // find whatever input type the arg references
    const argType = String(
      (schema.getType('Mutation') as GraphQLObjectType).getFields().createUser.args[0].type
    )
    const inputName = argType.replace(/!$/, '')
    const inputType = schema.getType(inputName)
    expect(inputType).toBeInstanceOf(GraphQLInputObjectType)
    const fields = (inputType as GraphQLInputObjectType).getFields()
    expect(String(fields.name.type)).toBe('String!')
    expect(String(fields.age.type)).toBe('Number') // optional → nullable
  })
})

describe('GraphQL features — nested objects & recursion', () => {
  it('nested object types are emitted and referenced', () => {
    const schema = schemaFor(`
      class Address { street!: string }
      class User { id!: number; address!: Address }
      export const graphql = { Query: { user: (): User => ({} as User) } }
    `)
    expect(schema.getType('Address')).toBeInstanceOf(GraphQLObjectType)
    expect(ft(schema, 'User', 'address')).toBe('Address!')
  })

  it('self-referential types resolve', () => {
    const schema = schemaFor(`
      class Node { id!: number; parent!: Node | null; children!: Node[] }
      export const graphql = { Query: { node: (): Node => ({} as Node) } }
    `)
    expect(ft(schema, 'Node', 'parent')).toBe('Node')
    expect(ft(schema, 'Node', 'children')).toBe('[Node!]!')
  })
})

describe('GraphQL features — enums', () => {
  it('string-literal unions become enums', () => {
    const schema = schemaFor(`
      type Role = "ADMIN" | "USER" | "GUEST"
      class Account { id!: number; role!: Role }
      export const graphql = { Query: { account: (): Account => ({} as Account) } }
    `)
    const role = schema.getType('Role')
    expect(role).toBeInstanceOf(GraphQLEnumType)
    expect((role as GraphQLEnumType).getValues().map(v => v.name).sort()).toEqual([
      'ADMIN',
      'GUEST',
      'USER'
    ])
    expect(ft(schema, 'Account', 'role')).toBe('Role!')
  })
})

describe('GraphQL features — unions', () => {
  it('union of distinct objects', () => {
    const schema = schemaFor(`
      type A = { a: string }
      type B = { b: number }
      type Result = A | B
      export const graphql = { Query: { result: (): Result => ({ a: "x" }) } }
    `)
    const r = schema.getType('Result')
    expect(r).toBeInstanceOf(GraphQLUnionType)
    expect((r as GraphQLUnionType).getTypes().map(t => t.name).sort()).toEqual(['A', 'B'])
  })
})

describe('GraphQL features — interfaces (inheritance)', () => {
  it('a shared base becomes an interface the types implement', () => {
    const schema = schemaFor(`
      class Node { id!: string }
      class User extends Node { email!: string }
      class Post extends Node { title!: string }
      export const graphql = {
        Query: { user: (): User => ({} as User), post: (): Post => ({} as Post) }
      }
    `)
    const user = schema.getType('User') as GraphQLObjectType
    const ifaceNames = user.getInterfaces().map(i => i.name)
    expect(ifaceNames.length).toBeGreaterThan(0)
    // the shared `id` field is present on the implementor
    expect(ft(schema, 'User', 'id')).toBe('String!')
    expect(ft(schema, 'User', 'email')).toBe('String!')
  })
})

describe('GraphQL features — roots & promises', () => {
  it('Query and Mutation roots both resolve', () => {
    const schema = schemaFor(`
      class User { id!: number }
      export const graphql = {
        Query: { user: (): User => ({} as User) },
        Mutation: { rename: (name: string): User => ({} as User) }
      }
    `)
    expect(schema.getQueryType()?.getFields().user).toBeDefined()
    expect(schema.getMutationType()?.getFields().rename).toBeDefined()
    expect(ft(schema, 'Mutation', 'rename')).toBe('User!')
  })

  it('promise return types are unwrapped', () => {
    const schema = schemaFor(`
      class User { id!: number }
      export const graphql = {
        Query: {
          one: (): Promise<User> => ({} as any),
          many: (): Promise<User[]> => ([] as any)
        }
      }
    `)
    expect(ft(schema, 'Query', 'one')).toBe('User!')
    expect(ft(schema, 'Query', 'many')).toBe('[User!]!')
  })
})
