import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {describeSchema} from '../build/describe-schema'
import {wrapResult} from './wrap'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    me: User
    count(filter: String): Int!
    tags: [String!]!
    posts(first: Int): [Post!]!
  }
  type User {
    name: String
    verified: Boolean!
    friends: [User!]!
  }
  type Post {
    id: ID!
    title: String
  }
`)
const descriptor = describeSchema(schema)

const wrap = (data: any) => wrapResult<any>(() => data, descriptor)

describe('wrapResult', () => {
  it('returns raw scalars so === and truthiness work', () => {
    const data = wrap({me: {name: 'Ada', verified: true}})
    expect(data.me.name).toBe('Ada')
    expect(data.me.name === 'Ada').toBe(true)
    expect(data.me.verified).toBe(true)
    expect(!!data.me.verified).toBe(true)
  })

  it('keeps callable arg-fields callable (args ignored at read time)', () => {
    const data = wrap({count: 42})
    expect(typeof data.count).toBe('function')
    expect(data.count('anything')).toBe(42)
  })

  it('returns real arrays for list fields', () => {
    const data = wrap({tags: ['a', 'b']})
    expect(Array.isArray(data.tags)).toBe(true)
    expect(data.tags.map((t: string) => t.toUpperCase())).toEqual(['A', 'B'])
    expect(data.tags.length).toBe(2)
  })

  it('wraps object list elements (callable list field)', () => {
    const data = wrap({posts: [{id: '1', title: 'Hi'}]})
    const posts = data.posts() // callable: has `first` arg
    expect(posts[0].title).toBe('Hi')
    expect(posts[0].id).toBe('1')
  })

  it('supports nested object lists', () => {
    const data = wrap({me: {friends: [{name: 'X'}, {name: 'Y'}]}})
    expect(data.me.friends.map((f: any) => f.name)).toEqual(['X', 'Y'])
  })

  it('handles nullable objects with optional chaining', () => {
    const data = wrap({me: null})
    expect(data.me).toBeNull()
    expect(data.me?.name).toBeUndefined()
  })

  it('serializes back to raw data via toJSON', () => {
    const raw = {me: {name: 'Ada', verified: false}}
    const data = wrap(raw)
    expect(JSON.parse(JSON.stringify(data))).toEqual(raw)
  })
})
