import {buildSchema} from 'graphql'
import {Project} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {extractQueries} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'
import {lowerQuery} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/selectors-to-document'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    user(id: ID!): User
    me: User
    posts(first: Int, after: String, last: Int, before: String): PostConnection!
  }
  type User {
    id: ID!
    name: String
    email: String
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

function extract(source: string, hookName = 'useData') {
  const project = new Project({
    compilerOptions: {allowJs: true, jsx: 4},
    useInMemoryFileSystem: true
  })
  project.createSourceFile('/Page.tsx', source)
  return extractQueries('/Page.tsx', project, {hookName})
}

describe('analyzer selectors → pylon-query document', () => {
  it('lowers a real useData component to a typed document', () => {
    const {queries} = extract(`
      import { useData } from '@getcronit/pylon/pages'
      export default function Page() {
        const id = '123'
        const data = useData()
        return <div>{data.user({ id }).name} {data.user({ id }).email}</div>
      }
    `)
    expect(queries.length).toBe(1)

    const lowered = lowerQuery(schema, queries[0].selectors, 'Page', '__doc')
    // Every compiled operation carries the always-on per-op `context` channel (§ACTING_TENANT).
    expect(lowered.compiled.body).toBe(
      'query Page($v0: ID!, $__context: String) @inContext(context: $__context) ' +
        '{ user(id: $v0) { name email __typename id } }'
    )
    expect(lowered.compiled.opContext).toBe(true)
    expect(lowered.docDeclaration).toContain('opContext: true')
    expect(lowered.variablesThunk).toBe('() => ({v0: id})')
    expect(lowered.docDeclaration).toContain('doc<')
    expect(lowered.docDeclaration).toContain('id: "q')
  })

  it('lowers a connection component for usePaginatedData', () => {
    const {queries} = extract(`
      import { usePaginatedData } from '@getcronit/pylon/pages'
      export default function Page() {
        const data = usePaginatedData()
        return <div>{data.posts.edges.map(e => e.node.title)}</div>
      }
    `, 'usePaginatedData')
    const lowered = lowerQuery(schema, queries[0].selectors, 'Page', '__doc', {
      connection: {path: ['posts']}
    })
    expect(lowered.compiled.connection).toEqual({
      path: ['posts'],
      first: 'p_first',
      after: 'p_after',
      last: 'p_last',
      before: 'p_before'
    })
    expect(lowered.compiled.body).toContain('node { title __typename id }')
    expect(lowered.docDeclaration).toContain('connection')
  })
})
