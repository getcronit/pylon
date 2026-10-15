import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {compileOperation} from '@/query/build/compile'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    post(id: ID!): Post
    posts(first: Int, after: String): PostConnection!
  }
  type Post {
    id: ID!
    title: String
    comments(first: Int, after: String, role: String): CommentConnection!
  }
  type CommentConnection {
    edges: [CommentEdge!]!
    pageInfo: PageInfo!
    totalCount: Int
  }
  type CommentEdge {
    cursor: String!
    node: Comment!
  }
  type Comment {
    id: ID!
    body: String
  }
  type PostConnection {
    edges: [PostEdge!]!
    pageInfo: PageInfo!
  }
  type PostEdge {
    cursor: String!
    node: Post!
  }
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }
`)

describe('nested connection (path > 1)', () => {
  it('compiles a connection nested under an intermediate field', () => {
    const op = compileOperation(
      schema,
      {
        post: {__args: '{ id: postId }', comments: {nodes: {body: true}}}
      },
      {name: 'Thread', connection: {path: ['post', 'comments']}}
    )

    // intermediate field carries its call-site arg; the connection is deep
    expect(op.body).toContain('post(id: $v0) {')
    expect(op.body).toContain(
      'comments(first: $p_first, after: $p_after, role: $role)'
    )
    expect(op.body).toContain('node { body __typename id }')
    expect(op.variables).toEqual([{name: 'v0', expr: 'postId'}])
    expect(op.connection).toMatchObject({
      path: ['post', 'comments'],
      first: 'p_first',
      after: 'p_after'
    })
  })

  it('declares a base (non-pagination) connection arg by its own name', () => {
    const op = compileOperation(
      schema,
      {posts: {nodes: {title: true}}},
      {name: 'Top', connection: {path: ['posts']}}
    )
    expect(op.body).toContain('posts(first: $p_first, after: $p_after)')
    expect(op.connection).toMatchObject({path: ['posts']})
  })
})
