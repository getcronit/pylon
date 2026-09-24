/**
 * Golden-master characterization for the Stage-4 refactor (introspection → IR).
 *
 * Stage 4 rewrites the type-walker to populate the IR directly. To verify it
 * preserves behaviour, we snapshot `toIR()` across a broad matrix of GraphQL
 * features NOW. After the refactor these snapshots must be byte-identical — any
 * diff is a behaviour change to inspect. We also assert that `toSDL(toIR())`
 * stays a valid, equivalent schema (parse round-trips) for every case.
 *
 * Snapshotting the IR (not just the SDL) is deliberate: the IR is exactly the
 * thing Stage 4 reconstructs, so it's the tightest possible guard.
 */
import {parse} from 'graphql'
import {toSDL} from '@/ir'
import {describe, expect, it} from 'vitest'
import {buildParser} from './test-utils'

/** Snapshot the IR and assert the IR→SDL round-trips through graphql-js. */
function characterize(code: string) {
  const ir = buildParser(code).toIR()
  expect(ir).toMatchSnapshot()
  // toSDL(ir) must be parseable, valid SDL.
  expect(() => parse(toSDL(ir))).not.toThrow()
  return ir
}

describe('IR characterization — scalars & nullability', () => {
  it('all primitive scalars', () => {
    characterize(`
      export const graphql = {
        Query: {
          str: () => "a",
          int: () => 1,
          float: () => 1.5,
          bool: () => true,
          date: () => new Date(),
          json: () => ({x: 1}) as any
        }
      }
    `)
  })

  it('optional and null-union fields', () => {
    characterize(`
      class T { req!: string; opt?: string; orNull!: string | null; numOrNull!: number | null }
      export const graphql = { Query: { t: (): T => ({} as T) } }
    `)
  })
})

describe('IR characterization — lists', () => {
  it('scalar lists, object lists, nested lists, nullable lists', () => {
    characterize(`
      class Item { id!: number }
      class T {
        scalars!: string[]
        items!: Item[]
        nested!: number[][]
        listOrNull!: string[] | null
        nullableItems!: (Item | null)[]
      }
      export const graphql = { Query: { t: (): T => ({} as T) } }
    `)
  })
})

describe('IR characterization — object graphs', () => {
  it('nested objects', () => {
    characterize(`
      class Address { street!: string; city!: string }
      class User { id!: number; address!: Address }
      export const graphql = { Query: { user: (): User => ({} as User) } }
    `)
  })

  it('self-referential (recursive) type', () => {
    characterize(`
      class Node { id!: number; parent!: Node | null; children!: Node[] }
      export const graphql = { Query: { node: (): Node => ({} as Node) } }
    `)
  })

  it('mutually recursive types', () => {
    characterize(`
      class A { id!: number; b!: B | null }
      class B { id!: number; a!: A | null }
      export const graphql = { Query: { a: (): A => ({} as A) } }
    `)
  })
})

describe('IR characterization — resolvers, args & inputs', () => {
  it('promise return types', () => {
    characterize(`
      class User { id!: number }
      export const graphql = {
        Query: {
          one: (): Promise<User> => ({} as any),
          many: (): Promise<User[]> => ([] as any)
        }
      }
    `)
  })

  it('positional scalar args', () => {
    characterize(`
      export const graphql = {
        Query: { greet: (name: string, times: number): string => name }
      }
    `)
  })

  it('object arg becomes an input (nested + optional)', () => {
    characterize(`
      class User { id!: number; name!: string }
      export const graphql = {
        Mutation: {
          createUser: (input: { name: string; age?: number; tags: string[] }): User => ({} as User)
        }
      }
    `)
  })
})

describe('IR characterization — unions, interfaces & enums', () => {
  it('union of distinct objects', () => {
    characterize(`
      type A = { a: string }
      type B = { b: number }
      type R = A | B
      export const graphql = { Query: { r: (): R => ({ a: "x" }) } }
    `)
  })

  it('class inheritance → interface', () => {
    characterize(`
      class Node { id!: number }
      class User extends Node { email!: string }
      class Post extends Node { title!: string }
      export const graphql = { Query: { user: (): User => ({} as User), post: (): Post => ({} as Post) } }
    `)
  })

  it('string-literal union → enum', () => {
    characterize(`
      type Role = "ADMIN" | "USER" | "GUEST"
      class Account { id!: number; role!: Role }
      export const graphql = { Query: { account: (): Account => ({} as Account) } }
    `)
  })
})

describe('IR characterization — roots, typename & generics', () => {
  it('Query + Mutation together (multiple roots)', () => {
    // Subscriptions use a Repeater type (needs the dep) — covered by the
    // runtime example, not this in-memory matrix.
    characterize(`
      class User { id!: number }
      export const graphql = {
        Query: { user: (): User => ({} as User) },
        Mutation: { setName: (name: string): User => ({} as User) }
      }
    `)
  })

  it('__typename literal override', () => {
    characterize(`
      class Dog { __typename = "Animal" as const; name!: string }
      export const graphql = { Query: { dog: (): Dog => ({} as Dog) } }
    `)
  })

  it('JSDoc descriptions (type, field, resolver, enum)', () => {
    characterize(`
      /** A role */
      type Role = "ADMIN" | "USER"
      /** A user in the system */
      class User {
        /** The unique identifier */
        id!: string
        role!: Role
      }
      export const graphql = {
        Query: {
          /** Fetches a user by ID */
          user: (id: string): User => ({} as User)
        }
      }
    `)
  })

  it('Connection/Edge generics', () => {
    characterize(`
      interface Edge<T> { node: T; cursor: string }
      interface Connection<T> { edges: Edge<T>[]; pageInfo: PageInfo }
      interface PageInfo { hasNextPage: boolean; endCursor: string }
      type User = { id: string; name: string }
      export const graphql = { Query: { users: (): Connection<User> => ({ edges: [], pageInfo: {} as PageInfo }) } }
    `)
  })
})
