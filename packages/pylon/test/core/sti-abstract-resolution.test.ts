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
import {resolversToGraphQLResolvers} from '@/core/define-pylon'

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
  /**
   * The same failure, reached from the other side: the client DOES select
   * `__typename`, but only under an ALIAS.
   *
   * `getSelectedFields` keys its map by the field NAME, so an aliased
   * `rcType: __typename` registers as `__typename` and the auto-injection is
   * skipped — while `wrapResolver` projects the value out under the ALIAS. The
   * node then reaches `resolveType` carrying `rcType` and no `__typename`, and
   * GraphQL throws "must resolve to an Object type".
   *
   * Nobody writes this by hand, which is why it went unnoticed. Plugins do:
   * `@graphql-yoga/plugin-response-cache` rewrites documents to collect entity
   * ids and adds `__responseCacheTypeName: __typename` / `__responseCacheId: id`
   * to every selection set. Turning that cache on is enough to make every
   * abstract field in an app stop resolving — silently, since the field just
   * nulls out.
   */
  it('resolves when __typename is selected only under an alias', async () => {
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
            rcType: __typename
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

    expect(res.errors, 'an aliased __typename must not break resolution').toBeUndefined()
    expect(res.data).toEqual({
      parties: [
        {rcType: 'Person', id: '1', firstName: 'Ann'},
        {rcType: 'Org', id: '2', legalName: 'ACME'}
      ]
    })
  })
  /**
   * The shape a gateway + response cache actually produces: a PLAIN
   * `__typename` and an ALIASED one on the same abstract field.
   *
   * The gateway injects `__typename` so it can pick a patch; the cache adds
   * `__responseCacheTypeName: __typename` so it can collect entity ids. Both
   * land in one selection set, and `wrapResolver` then sees a field with mixed
   * aliased/unaliased nodes and replaces the value with a FUNCTION that routes
   * per execution. That is correct for an ordinary field and fatal here:
   * `resolveType` reads `node.__typename` synchronously, before any resolver
   * runs, so it receives the function and GraphQL throws — naming the value it
   * got as "[function]".
   */
  it('resolves when __typename is selected both plainly and under an alias', async () => {
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
            rcType: __typename
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

    expect(
      res.errors,
      'a plain and an aliased __typename together must still resolve'
    ).toBeUndefined()
    expect(res.data).toEqual({
      parties: [
        {__typename: 'Person', rcType: 'Person', id: '1', firstName: 'Ann'},
        {__typename: 'Org', rcType: 'Org', id: '2', legalName: 'ACME'}
      ]
    })
  })
})
