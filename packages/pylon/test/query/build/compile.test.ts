import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {compileOperation, type SelectorNode} from '@/query/build/compile'

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

  it('emits distinct aliased fields for the SAME root field read with DIFFERENT args', () => {
    // The analyzer models multiple different-args reads of one field as an array of
    // arg-branches. They must NOT collapse into one field (first-args-wins) — that made
    // `data.count({filter:"a"})` and `data.count({filter:"b"})` return the same value.
    const op = compile({
      count: [{__args: '{ filter: a }'}, {__args: '{ filter: b }'}]
    })
    // Two variables (one per branch), each keeping its own call-site expr.
    expect(op.variables).toEqual([
      {name: 'v0', expr: 'a'},
      {name: 'v1', expr: 'b'}
    ])
    // Branch 0 keeps the base field name; branch 1 gets a deterministic arg-alias.
    expect(op.body).toBe(
      'query Test($v0: String, $v1: String) ' +
        '{ count(filter: $v0) count__pqArg__1: count(filter: $v1) }'
    )
    // Metadata so the runtime can map a call's args → the right alias (by arg→variable).
    expect(op.argAliases).toEqual({
      count: [
        {alias: 'count', args: {filter: 'v0'}},
        {alias: 'count__pqArg__1', args: {filter: 'v1'}}
      ]
    })
  })

  it('aliases a conflicting union-member field; merges same-typed ones', () => {
    const s = buildSchema(/* GraphQL */ `
      type Query { hit: Thing }
      union Thing = A | B
      type A { id: ID! status: AStatus! label: String }
      type B { id: ID! status: BStatus! label: String }
      enum AStatus { X }
      enum BStatus { Y }
    `)
    const op = compileOperation(s, {hit: {status: true, label: true}}, {name: 'T'})
    // `status` clashes (AStatus! vs BStatus!) → aliased per member so the query merges;
    // `label` is String on both → left un-aliased.
    expect(op.body).toContain('... on A { status__pqAbs__A: status label __typename id }')
    expect(op.body).toContain('... on B { status__pqAbs__B: status label __typename id }')
    expect(op.body).not.toContain('label__pqAbs__')
    // TS still reads `status`/`label` (merged-optional across members).
    expect(op.resultType).toContain('status?:')
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

  it('selects startIndex + passes an anchor base var when the connection exposes them', () => {
    const s = buildSchema(/* GraphQL */ `
      type Query {
        posts(first: Int, after: String, last: Int, before: String, anchor: String): PostConnection!
      }
      type PostConnection {
        edges: [PostEdge!]!
        pageInfo: PageInfo!
        totalCount: Int
        startIndex: Int!
      }
      type PostEdge { cursor: String! node: Post! }
      type Post { id: ID! title: String }
      type PageInfo { hasNextPage: Boolean! hasPreviousPage: Boolean! startCursor: String endCursor: String }
    `)
    const op = compileOperation(
      s,
      {posts: {edges: {node: {title: true}}}},
      {name: 'Test', connection: {path: ['posts']}}
    )
    // startIndex is a real connection field → auto-selected like totalCount.
    expect(op.body).toContain('startIndex')
    // `anchor` is a base arg bound by its own name, and recorded in meta so the
    // hook's imperative seekTo(id) knows the variable to set.
    expect(op.body).toContain('anchor: $anchor')
    expect(op.connection).toMatchObject({ anchor: 'anchor' })
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

  it('recognises a connection nested UNDER an interface field (STI base)', () => {
    // `party` returns an interface; the connection `attachments` is a common field on
    // it. The terminal-connection detection must fire on the abstract path too, else
    // the hook controls (isLoadingMore) leak and fail validation. Regression for STI
    // bases whose relations are reached through `interface Contact`.
    const ifaceSchema = buildSchema(/* GraphQL */ `
      type Query { party: Party }
      interface Party { id: ID! attachments(first: Int): AssetConnection! }
      type Person implements Party { id: ID! attachments(first: Int): AssetConnection! }
      type AssetConnection { edges: [AssetEdge!]! pageInfo: PageInfo! totalCount: Int }
      type AssetEdge { cursor: String! node: Asset! }
      type Asset { id: ID! name: String }
      type PageInfo { hasNextPage: Boolean! hasPreviousPage: Boolean! startCursor: String endCursor: String }
    `)
    const op = compileOperation(
      ifaceSchema,
      {
        party: {
          attachments: {
            nodes: {name: true},
            isLoadingMore: true,
            pageInfo: {hasNextPage: true}
          }
        } as any
      },
      {name: 'Test', connection: {path: ['party', 'attachments']}}
    )
    expect(op.body).toContain('node { name __typename id }')
    expect(op.body).not.toContain('isLoadingMore')
  })

  it('merges conditional branches into one selection', () => {
    const op = compile({me: [{name: true}, {age: true}] as any})
    expect(op.body).toBe('query Test { me { name age __typename id } }')
  })
})
