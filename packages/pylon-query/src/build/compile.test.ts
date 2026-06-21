import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {compileOperation, type SelectorNode} from './compile'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    me: User
    user(id: ID!): User
    count(filter: String): Int
    posts(first: Int, after: String, last: Int, before: String): PostConnection!
  }
  type User {
    id: ID!
    name: String
    age: Int!
    role: Role
  }
  enum Role {
    ADMIN
    USER
  }
  type PostConnection {
    edges: [PostEdge!]!
    pageInfo: PageInfo!
    totalCount: Int
  }
  type PostEdge {
    cursor: String!
    node: Post!
  }
  type Post {
    id: ID!
    title: String
  }
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }
`)

const compile = (selectors: SelectorNode, opts?: any) =>
  compileOperation(schema, selectors, {name: 'Test', ...opts})

describe('compileOperation', () => {
  it('compiles a simple nested selection (auto-selects __typename + id)', () => {
    const op = compile({me: {name: true, age: true}})
    expect(op.body).toBe('query Test { me { name age __typename id } }')
    expect(op.variables).toEqual([])
    // TS type omits the auto-injected infra fields.
    expect(op.resultType).toBe(
      '{ me: { name: string | null; age: number } | null }'
    )
  })

  it('lifts field arguments into variables', () => {
    const op = compile({user: {__args: '{ id: userId }', name: true}})
    expect(op.body).toBe(
      'query Test($v0: ID!) { user(id: $v0) { name __typename id } }'
    )
    expect(op.variables).toEqual([{name: 'v0', expr: 'userId'}])
  })

  it('handles a scalar field with arguments (no meta injection on scalars)', () => {
    const op = compile({count: {__args: '{ filter: q }'}})
    expect(op.body).toBe('query Test($v0: String) { count(filter: $v0) }')
    expect(op.variables).toEqual([{name: 'v0', expr: 'q'}])
    expect(op.resultType).toBe('{ count: number | null }')
  })

  it('renders enums as string-literal unions', () => {
    const op = compile({me: {role: true}})
    expect(op.resultType).toBe('{ me: { role: "ADMIN" | "USER" | null } | null }')
  })

  it('throws on an unknown field (fail-loud contract)', () => {
    expect(() => compile({me: {nope: true}})).toThrow(/does not exist/)
  })

  it('throws on an unknown argument', () => {
    expect(() => compile({user: {__args: '{ bad: x }'}})).toThrow(
      /no argument "bad"/
    )
  })

  it('compiles a Relay connection with runtime pagination variables', () => {
    const op = compile(
      {posts: {edges: {node: {title: true}}}},
      {connection: {path: ['posts']}}
    )
    expect(op.connection).toEqual({
      path: ['posts'],
      first: 'p_first',
      after: 'p_after',
      last: 'p_last',
      before: 'p_before'
    })
    expect(op.body).toContain(
      'posts(first: $p_first, after: $p_after, last: $p_last, before: $p_before)'
    )
    expect(op.body).toContain('hasNextPage hasPreviousPage startCursor endCursor')
    expect(op.body).toContain('node { title __typename id }')
    expect(op.body).toContain('totalCount')
  })

  it('compiles a connection from the `nodes` accessor, ignoring hook controls', () => {
    const op = compile(
      {
        posts: {
          nodes: {title: true},
          loadNext: true,
          isLoadingMore: true,
          pageInfo: {hasNextPage: true}
        } as any
      },
      {connection: {path: ['posts']}}
    )
    expect(op.body).toContain('node { title __typename id }')
    // hook controls are not GraphQL fields → never selected
    expect(op.body).not.toContain('loadNext')
    expect(op.body).not.toContain('isLoadingMore')
  })

  it('merges conditional branches into one selection', () => {
    const op = compile({me: [{name: true}, {age: true}] as any})
    expect(op.body).toBe('query Test { me { name age __typename id } }')
  })
})
