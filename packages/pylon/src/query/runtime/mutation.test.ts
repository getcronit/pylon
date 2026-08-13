import {buildSchema} from 'graphql'
import {describe, expect, it, vi} from 'vitest'
import {allScalarSelectors, compileOperation} from '../build/compile'
import {describeSchema} from '../build/describe-schema'
import {createPylonQueryClient} from './client'
import {doc} from './doc'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    me: User
  }
  type Mutation {
    createUser(name: String!): User!
    rename(id: ID!, name: String!): User!
  }
  type User {
    id: ID!
    name: String
    email: String
  }
`)

describe('mutation compilation', () => {
  it('allScalarSelectors lists argument-free scalar/enum fields', () => {
    expect(allScalarSelectors(schema, 'User')).toEqual({
      id: true,
      name: true,
      email: true
    })
  })

  it('compiles a mutation: runtime args + allScalars + id + __typename', () => {
    const selectors = {createUser: allScalarSelectors(schema, 'User')}
    const op = compileOperation(schema, selectors, {
      name: 'CreateUser',
      operation: 'mutation',
      runtimeArgsField: 'createUser'
    })
    expect(op.body).toBe(
      'mutation CreateUser($name: String!) { createUser(name: $name) { id name email __typename } }'
    )
    // args are supplied at call time by mutate(vars), not from the source.
    expect(op.variables).toEqual([])
  })
})

describe('runMutation', () => {
  const descriptor = describeSchema(schema)

  it('normalizes the result, caches the entity, returns the field value', async () => {
    const fetcher = vi.fn(async () => ({
      data: {createUser: {__typename: 'User', id: '1', name: 'Ada', email: null}}
    }))
    const client = createPylonQueryClient({fetcher: fetcher as any, descriptor})
    const d = doc({
      id: 'm_create',
      body: 'mutation CreateUser($v0: String!) { createUser(name: $v0) { id name email __typename } }',
      name: 'CreateUser',
      rootField: 'createUser'
    })

    const user = await client.runMutation(d, {v0: 'Ada'})
    expect(user.id).toBe('1')
    expect(user.name).toBe('Ada')
    expect(client.store.getEntity('User:1')).toMatchObject({name: 'Ada', id: '1'})
  })

  it('a mutation patch updates an entity a query already cached', async () => {
    // Seed a query that read User:1 as "Ada".
    const queryClient = createPylonQueryClient({
      fetcher: (async () => ({
        data: {me: {__typename: 'User', id: '1', name: 'Ada'}}
      })) as any,
      descriptor
    })
    const meDoc = doc({id: 'q_me', body: 'query { me { id name __typename } }', name: 'Me'})
    await queryClient.fetch(meDoc)
    expect(queryClient.store.getEntity('User:1')).toMatchObject({name: 'Ada'})

    // The same client runs a rename mutation → entity patched in place.
    queryClient['fetcher'] = (async () => ({
      data: {rename: {__typename: 'User', id: '1', name: 'Ada Lovelace'}}
    })) as any
    const renameDoc = doc({
      id: 'm_rename',
      body: 'mutation { rename { id name __typename } }',
      name: 'Rename',
      rootField: 'rename'
    })
    await queryClient.runMutation(renameDoc, {})
    expect(queryClient.store.getEntity('User:1')).toMatchObject({name: 'Ada Lovelace'})
  })
})
