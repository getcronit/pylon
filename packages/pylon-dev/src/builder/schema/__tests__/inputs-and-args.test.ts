import {describe, it, expect} from 'vitest'
import {buildTestSchema} from './test-utils'

describe('Pylon Builder - Inputs and Arguments', () => {
  it('should handle nested arguments (the standard Pylon pattern)', () => {
    const code = `
      interface CreateUserInput {
        username: string
        email?: string
      }

      export const graphql = {
        Query: {
          user: (args: { id: string }) => ({ username: "test" }),
        },
        Mutation: {
          createUser: (args: { input: CreateUserInput }) => ({ username: args.input.username })
        }
      }
    `
    const result = buildTestSchema(code)

    // Mutation field should have 'args' argument
    expect(result.typeDefs).toContain(
      'createUser(args: CreateUserArgsInput!): CreateUser!'
    )
    // The input type should be generated
    expect(result.typeDefs).toContain('input CreateUserArgsInput')
    expect(result.typeDefs).toContain('input Input')

    expect(result).toMatchSnapshot()
  })

  it('should handle direct positional arguments', () => {
    const code = `
      export const graphql = {
        Mutation: {
          updateUser: (id: string, username: string, age?: number) => ({ id, username })
        }
      }
    `
    const result = buildTestSchema(code)

    // updateWithDirectArgs(id: String!, username: String!, age: Number): ...
    expect(result.typeDefs).toContain(
      'updateUser(id: String!, username: String!, age: Number): UpdateUser!'
    )

    expect(result).toMatchSnapshot()
  })

  it('should handle mix of named objects and primitives', () => {
    const code = `
      interface Profile { bio: string }
      export const graphql = {
        Mutation: {
          setup: (id: string, profile: Profile) => ({ id })
        }
      }
    `
    const result = buildTestSchema(code)

    expect(result.typeDefs).toContain(
      'setup(id: String!, profile: SetupProfileInput!): Setup!'
    )
    expect(result.typeDefs).toContain('input SetupProfileInput')

    expect(result).toMatchSnapshot()
  })

  it('should handle the "input" parameter pattern', () => {
    const code = `
      export const graphql = {
        Mutation: {
          createUser: (input: { username: string; email: string }) => ({ username: input.username })
        }
      }
    `
    const result = buildTestSchema(code)

    // Resulting GraphQL should have 'input' argument
    expect(result.typeDefs).toContain(
      'createUser(input: CreateUserInput!): CreateUser!'
    )
    expect(result.typeDefs).toContain('input CreateUserInput')

    expect(result).toMatchSnapshot()
  })

  it('should handle rest parameters with tuple types', () => {
    const code = `
      export const graphql = {
        Query: {
          search: (...args: [query: string, limit?: number]) => []
        }
      }
    `
    const result = buildTestSchema(code)

    expect(result.typeDefs).toContain(
      'search(query: String!, limit: Number): [JSONObject!]!'
    )

    expect(result).toMatchSnapshot()
  })

  it('should handle optional enums without warning', () => {
    const code = `
      type Role = "ADMIN" | "USER"

      export const graphql = {
        Query: {
          users: (role?: Role) => []
        }
      }
    `
    const result = buildTestSchema(code)

    expect(result.typeDefs).toContain('users(role: Role): [JSONObject!]!')
    expect(result.typeDefs).toContain('enum Role')

    expect(result).toMatchSnapshot()
  })
})
