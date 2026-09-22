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
    // The input type should be generated. The nested `input` keeps its declared interface name
    // (CreateUserInput) rather than being renamed after the field.
    expect(result.typeDefs).toContain('input CreateUserArgsInput')
    expect(result.typeDefs).toContain('input CreateUserInput')

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

    // The named `Profile` interface keeps its declared name (ProfileInput) as the arg type.
    expect(result.typeDefs).toContain(
      'setup(id: String!, profile: ProfileInput!): Setup!'
    )
    expect(result.typeDefs).toContain('input ProfileInput')

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

  it('should handle enums shared between input and output', () => {
    const code = `
      type Status = "ACTIVE" | "INACTIVE"

      export const graphql = {
        Query: {
          checkStatus: (status: Status) => {
            return {
              id: "1",
              status: status
            }
          }
        }
      }
    `
    const result = buildTestSchema(code)

    expect(result.typeDefs).toContain(
      'checkStatus(status: Status!): CheckStatus!'
    )
    expect(result.typeDefs).toContain('type CheckStatus')
    expect(result.typeDefs).toContain('status: Status!')
    expect(result.typeDefs).toContain('enum Status')

    expect(result).toMatchSnapshot()
  })

  it('does not merge same-named nested inputs that differ only by OPTIONAL fields', () => {
    // Two mutations expose a `lines` array of different shape: a priced line (with an optional
    // `unitPrice`) and a priceless one. The two shapes are mutually assignable in TS (the extra
    // property is optional), so a naming test based on assignability alone would collapse them
    // onto ONE input type = their intersection, silently dropping `unitPrice`. Each shape must
    // instead get its own input type; the priced field must survive.
    const code = `
      interface PricedLine { description: string; quantity?: number; unitPrice?: number }
      interface FreeLine { description: string; quantity?: number }
      export const graphql = {
        Mutation: {
          createInvoice: (args: { input: { title: string; lines: PricedLine[] } }) => ({ ok: true }),
          createDelivery: (args: { input: { title: string; lines: FreeLine[] } }) => ({ ok: true }),
        }
      }
    `
    const result = buildTestSchema(code)

    // The priced line's field must not be dropped by a wrongful merge.
    expect(result.typeDefs).toContain('unitPrice')

    // The two `lines` shapes must resolve to DISTINCT input types.
    const linesTypes = [...result.typeDefs.matchAll(/lines: \[(\w+)!\]/g)].map(
      m => m[1]
    )
    expect(linesTypes.length).toBe(2)
    expect(new Set(linesTypes).size).toBe(2)

    expect(result).toMatchSnapshot()
  })
})
