/**
 * Regression: an abstract type (interface/union) whose members add NO unique NON-NULL
 * field — e.g. single-table-inheritance subclasses `Person`/`Organization` that are
 * structurally identical apart from all-nullable fields. Their only discriminant is the
 * `__typename` the ORM stamps on each row. But `wrapResolver` re-projects every resolved
 * object down to its SELECTED fields before `resolveType` runs, so `__typename` must be
 * auto-injected into the selection (`getSelectedFields`) — otherwise the node reaches
 * `resolveType` with no discriminant and GraphQL throws "must resolve to an Object type".
 */
import {describe, expect, it} from 'vitest'
import {buildSchema, graphql, type GraphQLInterfaceType} from 'graphql'
import {resolversToGraphQLResolvers} from './define-pylon'

/** Stamp `__typename` the way the ORM's `hydrate`/`create` do — readonly + NON-enumerable. */
const stamp = <T extends object>(o: T, name: string): T => {
  Object.defineProperty(o, '__typename', {
    value: name,
    enumerable: false,
    configurable: true
  })
  return o
}

describe('STI abstract resolution', () => {
  it('resolves members with no unique non-null field via the stamped __typename', async () => {
    const schema = buildSchema(/* GraphQL */ `
      type Query {
        parties: [Party!]!
      }
      interface Party {
        id: ID!
      }
      type Person implements Party {
        id: ID!
        firstName: String
      }
      type Org implements Party {
        id: ID!
        legalName: String
      }
    `)

    const resolvers = {
      Query: {
        parties: () => [
          stamp({id: '1', firstName: 'Ann'}, 'Person'),
          stamp({id: '2', legalName: 'ACME'}, 'Org')
        ]
      },
      // The universal resolver: trust the stamped __typename.
      Party: {__resolveType: (n: any) => (n && n.__typename) || null}
    }

    const gql = resolversToGraphQLResolvers(resolvers as any)
    ;(schema.getType('Party') as GraphQLInterfaceType).resolveType =
      resolvers.Party.__resolveType as any
    ;(schema.getQueryType()!.getFields() as any).parties.resolve = (
      gql.Query as any
    ).parties

    const res = await graphql({
      schema,
      source: /* GraphQL */ `
        {
          parties {
            __typename
            id
            ... on Person {
              firstName
            }
            ... on Org {
              legalName
            }
          }
        }
      `
    })

    expect(res.errors).toBeUndefined()
    expect(res.data).toEqual({
      parties: [
        {__typename: 'Person', id: '1', firstName: 'Ann'},
        {__typename: 'Org', id: '2', legalName: 'ACME'}
      ]
    })
  })
})
