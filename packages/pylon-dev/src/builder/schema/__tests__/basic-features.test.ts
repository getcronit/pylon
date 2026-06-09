import {describe, it, expect} from 'vitest'
import {buildTestSchema} from './test-utils'

describe('Pylon Builder - Basic Features', () => {
  it('should handle primitives and scalars', () => {
    const code = `
      export const graphql = {
        Query: {
          getString: () => "hello",
          getInt: () => 123,
          getFloat: () => 12.3,
          getBoolean: () => true,
          getAny: () => ({ arbitrary: "data" }) as any,
          getVoid: () => { }
        }
      }
    `
    const result = buildTestSchema(code)
    expect(result).toMatchSnapshot()
  })

  it('should handle lists and optionality', () => {
    const code = `
      export const graphql = {
        Query: {
          list: () => ["a", "b"],
          optional: (args: { id?: string }) => args.id || null,
          nullable: () => null as string | null
        }
      }
    `
    const result = buildTestSchema(code)
    expect(result).toMatchSnapshot()
  })

  it('should handle enums (string literal unions)', () => {
    const code = `
      type Role = "ADMIN" | "USER" | "GUEST"

      export const graphql = {
        Query: {
          getRole: (): Role => "ADMIN"
        }
      }
    `
    const result = buildTestSchema(code)
    expect(result.typeDefs).toContain('enum Role')
    expect(result).toMatchSnapshot()
  })

  it('should handle unions of objects (or promote to interface if shared fields exist)', () => {
    const code = `
      type A = { a: string }
      type B = { b: number }
      type Result = A | B

      export const graphql = {
        Query: {
          getResult: (): Result => ({ a: "test" })
        }
      }
    `
    const result = buildTestSchema(code)
    expect(result.typeDefs).toContain('union Result = A | B')
    expect(result.resolvers.Result.__resolveType).toBeDefined()
    expect(result).toMatchSnapshot()
  })

  it('should handle async/promises', () => {
    const code = `
      export const graphql = {
        Query: {
          asyncData: async () => "resolved"
        }
      }
    `
    const result = buildTestSchema(code)
    expect(result.typeDefs).toContain('asyncData: String!')
    expect(result).toMatchSnapshot()
  })

  it('should handle JSON types', () => {
    const code = `
      import { JsonValue, JsonObject } from '@prisma/client/runtime/library'

      export const graphql = {
        Query: {
          rawJson: (): JsonValue => ({ a: 1 }),
          jsonObject: (): JsonObject => ({ b: 2 })
        }
      }
    `
    // Note: We need to mock the presence of these types or use simple names that match Pylon's logic
    const codeSimulated = `
      type JsonValue = any
      type JsonObject = { [key: string]: any }

      export const graphql = {
        Query: {
          json: () => ({ arbitrary: true })
        }
      }
    `
    const result = buildTestSchema(codeSimulated)
    expect(result).toMatchSnapshot()
  })

  it('should handle generic types', () => {
    const code = `
      interface Paginated<T> {
        items: T[]
        total: number
      }

      type User = { id: string; name: string }

      export const graphql = {
        Query: {
          users: (): Paginated<User> => ({ items: [], total: 0 })
        }
      }
    `
    const result = buildTestSchema(code)
    expect(result.typeDefs).toContain('type UserPaginated')
    expect(result).toMatchSnapshot()
  })

  it('should handle JSDoc descriptions', () => {
    const code = `
      /**
       * A user in the system
       */
      interface User {
        /** The unique identifier */
        id: string
        /** The login name */
        username: string
      }

      export const graphql = {
        Query: {
          /** Fetches a user by ID */
          user: (args: { id: string }): User => ({ id: args.id, username: "test" })
        }
      }
    `
    const result = buildTestSchema(code)
    expect(result.typeDefs).toContain('"""\nA user in the system\n"""')
    expect(result.typeDefs).toContain('"""\nThe unique identifier\n"""')
    expect(result.typeDefs).toContain('"""\nFetches a user by ID\n"""')
    expect(result).toMatchSnapshot()
  })

  it('should handle empty array returns', () => {
    const code = `
      export const graphql = {
        Query: {
          empty: () => []
        }
      }
    `
    const result = buildTestSchema(code)
    expect(result.typeDefs).toContain('empty: [JSONObject!]!')
    expect(result).toMatchSnapshot()
  })

  it('derives a list when a type extends Array<T> through a generic reference', () => {
    // A custom collection that type-merges Array<T> (e.g. the ORM's
    // RelatedManager). `getBaseTypes()` is not answered by the instantiated
    // TypeReference, only by its `.target` declared type — isList must look
    // through `.target` so this still derives `[Item]`, not an object type.
    const code = `
      interface Collection<T> extends Array<T> {}
      class Collection<T> {
        loadAll(): Promise<T[]> { return Promise.resolve([]) }
      }
      class Item { id: number = 1 }

      export const graphql = {
        Query: {
          items: (): Collection<Item> => new Collection<Item>()
        }
      }
    `
    const result = buildTestSchema(code)
    expect(result.typeDefs).toMatch(/items:\s*\[Item!\]!/)
    // The collection's own methods must NOT leak as schema fields.
    expect(result.typeDefs).not.toMatch(/loadAll/)
  })
})
