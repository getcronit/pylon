import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {compileOperation, type SelectorNode} from './compile'
import {describeSchema} from './describe-schema'
import {wrapResult} from '../runtime/wrap'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    feed: [Node!]!
    node: Node
    result: SearchResult
  }
  interface Node {
    id: ID!
  }
  type Post implements Node {
    id: ID!
    title: String
    author: User
  }
  type Comment implements Node {
    id: ID!
    body: String
  }
  type User {
    id: ID!
    name: String
  }
  union SearchResult = Post | User
`)

const compile = (selectors: SelectorNode, name = 'Test') =>
  compileOperation(schema, selectors, {name})

describe('interface compilation', () => {
  it('partitions fields into inline fragments + a shared __typename', () => {
    const op = compile({feed: {id: true, title: true, body: true}})
    expect(op.body).toContain('feed { id __typename')
    expect(op.body).toContain('... on Post { title __typename id }')
    expect(op.body).toContain('... on Comment { body __typename id }')
  })

  it('produces a merged-optional result type', () => {
    const op = compile({node: {id: true, title: true, body: true}})
    // interface field required, concrete fields optional, __typename a literal union
    expect(op.resultType).toContain('id: string')
    expect(op.resultType).toContain('title?: string | null')
    expect(op.resultType).toContain('body?: string | null')
    expect(op.resultType).toContain('__typename: "Post" | "Comment"')
  })

  it('compiles nested concrete object fields inside a fragment', () => {
    const op = compile({feed: {author: {name: true}}})
    expect(op.body).toContain('... on Post { author { name __typename id }')
  })

  it('handles unions (no shared fields)', () => {
    const op = compile({result: {title: true, name: true}})
    expect(op.body).toContain('... on Post { title __typename id }')
    expect(op.body).toContain('... on User { name __typename id }')
  })

  it('fails loud on a field present on no possible type', () => {
    expect(() => compile({feed: {nope: true}})).toThrow(/does not exist/)
  })
})

describe('interface reads (wrapper __typename dispatch)', () => {
  const descriptor = describeSchema(schema)

  it('resolves concrete fields by the runtime __typename', () => {
    const data = wrapResult<any>(
      () => ({
        feed: [
          {__typename: 'Post', id: '1', title: 'Hi'},
          {__typename: 'Comment', id: '2', body: 'Yo'}
        ]
      }),
      descriptor
    )
    expect(data.feed[0].__typename).toBe('Post')
    expect(data.feed[0].id).toBe('1')
    expect(data.feed[0].title).toBe('Hi')
    expect(data.feed[0].body).toBeUndefined() // not a Comment
    expect(data.feed[1].body).toBe('Yo')
    expect(data.feed[1].title).toBeUndefined()
  })
})
