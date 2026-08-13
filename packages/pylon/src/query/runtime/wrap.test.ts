import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {describeSchema} from '../build/describe-schema'
import {stableStringify} from './hash'
import {wrapResult} from './wrap'

const schema = buildSchema(/* GraphQL */ `
  type Query {
    me: User
    count(filter: String): Int!
    sized(n: Int!): Int!
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

  it('routes a callable root field to the alias matching the CALL args', () => {
    // Same root field read with two different args → the compiler emitted two aliased
    // response slots + an arg→alias map. `data.count({filter})` must resolve to the slot
    // whose args match the call (not always the first).
    const root = {count: 10, count__pqArg__1: 20}
    const argAliasMap = {
      count: {
        [stableStringify({filter: 'a'})]: 'count',
        [stableStringify({filter: 'b'})]: 'count__pqArg__1'
      }
    }
    const data = wrapResult<any>(
      () => root,
      descriptor,
      undefined,
      undefined,
      undefined,
      undefined,
      argAliasMap
    )
    expect(data.count({filter: 'a'})).toBe(10)
    expect(data.count({filter: 'b'})).toBe(20)
    // An unmatched / no-args call falls back to the base field.
    expect(data.count()).toBe(10)
  })

  it('keeps callable arg-fields callable (args ignored at read time)', () => {
    const data = wrap({count: 42})
    expect(typeof data.count).toBe('function')
    expect(data.count('anything')).toBe(42)
  })

  it('all-optional-arg fields are dual-mode: read as a value OR call', () => {
    const data = wrap({count: 42})
    // callable — `img.url({transform})` returns the plain (baked) value
    expect(data.count()).toBe(42)
    expect(data.count({filter: 'x'})).toBe(42)
    // AND readable as the value (coercion via toString / valueOf / toPrimitive)
    expect(`${data.count}`).toBe('42')
    expect(String(data.count)).toBe('42')
    expect(Number(data.count)).toBe(42)
    expect(data.count == 42).toBe(true) // eslint-disable-line eqeqeq
    // property/method forwarding to the resolved value
    expect((data.count as any).toFixed(1)).toBe('42.0')
  })

  it('a required-arg field stays call-only (not dual-mode)', () => {
    const data = wrap({sized: 7})
    expect(typeof data.sized).toBe('function')
    expect(data.sized(5)).toBe(7)
    // bare read is the raw call-only function (no value coercion)
    expect(`${data.sized}`).not.toBe('7')
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
