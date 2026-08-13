import {describe, it, expect} from 'vitest'
import {buildTestSchema} from './test-utils'

describe('Pylon Builder - Connection and Edge Generics', () => {
  it('should transform Connection<T> to TConnection and Edge<T> to TEdge', () => {
    const code = `
      interface Edge<T> {
        node: T
        cursor: string
      }

      interface Connection<T> {
        edges: Edge<T>[]
        pageInfo: PageInfo
      }

      interface PageInfo {
        hasNextPage: boolean
        hasPreviousPage: boolean
        startCursor: string
        endCursor: string
      }

      type User = {
        id: string
        name: string
      }

      export const graphql = {
        Query: {
          users: (): Connection<User> => ({
            edges: [],
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              startCursor: '',
              endCursor: ''
            }
          })
        }
      }
    `
    const result = buildTestSchema(code)

    expect(result.typeDefs).toContain('type UserConnection')
    expect(result.typeDefs).toContain('edges: [UserEdge!]!')
    expect(result.typeDefs).toContain('type UserEdge')
    expect(result.typeDefs).toContain('node: User!')

    expect(result).toMatchSnapshot()
  })

  it('should handle nested generics like Connection<Edge<User>>', () => {
    const code = `
      interface Edge<T> { node: T; cursor: string }
      interface Connection<T> { edges: Edge<T>[]; pageInfo: { hasNextPage: boolean } }
      type User = { id: string }

      export const graphql = {
        Query: {
          nested: (): Connection<Edge<User>> => ({
            edges: [],
            pageInfo: { hasNextPage: false }
          })
        }
      }
    `
    const result = buildTestSchema(code)

    // Edge<User> -> UserEdge
    // Connection<UserEdge> -> UserEdgeConnection
    expect(result.typeDefs).toContain('type UserEdgeConnection')
    expect(result.typeDefs).toContain('edges: [UserEdgeEdge!]!')

    expect(result).toMatchSnapshot()
  })
})
