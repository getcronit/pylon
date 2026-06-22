import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {generateRootType} from './root-type'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    me: User
    tickets(status: Status): [Ticket!]!
  }
  type User {
    id: ID!
    role: Role
  }
  type Ticket {
    id: ID!
    status: Status!
  }
  enum Role {
    ADMIN
    USER
  }
  enum Status {
    OPEN
    CLOSED
  }
`)

describe('generateRootType — enums', () => {
  const out = generateRootType(schema)

  it('emits a real importable value (as const object) per enum', () => {
    expect(out).toContain(
      'export const Role = {\n  ADMIN: "ADMIN",\n  USER: "USER"\n} as const'
    )
    expect(out).toContain(
      'export const Status = {\n  OPEN: "OPEN",\n  CLOSED: "CLOSED"\n} as const'
    )
  })

  it('keeps a same-named string-union type alias (literals still assign)', () => {
    expect(out).toContain('export type Role = "ADMIN" | "USER"')
    expect(out).toContain('export type Status = "OPEN" | "CLOSED"')
  })

  it('references enums by name in object fields and field args', () => {
    // output field → the enum type (union); arg → same
    expect(out).toMatch(/role: Role \| null/)
    expect(out).toMatch(/status\?: Status \| null/)
  })
})
