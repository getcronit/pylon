import {buildSchema} from 'graphql'
import {describe, expect, it} from 'vitest'
import {describeSchema} from '@/query/build/describe-schema'
import {stableStringify} from '@/query/runtime/hash'
import {wrapResult} from '@/query/runtime/wrap'

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
    tally(kind: String): Int
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
    // whose args match the call (not always the first). Keyed by `Type.field`.
    const root = {count: 10, count__pqArg__1: 20}
    const argAliasMap = {
      'Query.count': {
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

  it('routes a NESTED callable field by owner type, not just root fields', () => {
    // Regression: routing was gated on `ownerType === rootType`, so a nested field read
    // with several arg-sets always resolved to the base slot — every call returned the
    // first branch's value while looking perfectly plausible.
    const root = {me: {__typename: 'User', tally: 1, tally__pqArg__1: 2, tally__pqArg__2: 3}}
    const argAliasMap = {
      'User.tally': {
        [stableStringify({kind: 'a'})]: 'tally',
        [stableStringify({kind: 'b'})]: 'tally__pqArg__1',
        [stableStringify({kind: 'c'})]: 'tally__pqArg__2'
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
    expect(data.me.tally({kind: 'a'})).toBe(1)
    expect(data.me.tally({kind: 'b'})).toBe(2)
    expect(data.me.tally({kind: 'c'})).toBe(3)
    // Unmatched args fall back to the base slot rather than returning undefined.
    expect(data.me.tally({kind: 'zzz'})).toBe(1)
  })

  it('a same-named field on ANOTHER type routes independently', () => {
    // `Query.count` and a hypothetical `User.count` must not share routing — which is
    // exactly what a bare field-name key would have done.
    const root = {count: 10, count__pqArg__1: 20, me: {__typename: 'User', tally: 7}}
    const argAliasMap = {
      'Query.count': {
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
    expect(data.count({filter: 'b'})).toBe(20)
    // No entry for User.tally → plain read, args ignored (the pre-existing behaviour).
    expect(data.me.tally({kind: 'b'})).toBe(7)
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

  // Reference stability — the question behind `React.memo` on a virtualized feed row.
  // A memo comparator like `(a, b) => a.item === b.item` can only ever SKIP a re-render
  // if the wrapper hands back the SAME node object across renders.
  describe('reference identity — React.memo viability', () => {
    // Without an identity cache the wrap layer is a pure projection and mints a fresh
    // Proxy at every value boundary — the baseline that made memo impossible.
    it('mints a fresh proxy on each access when no identity cache is supplied', () => {
      const data = wrap({me: {__typename: 'User', friends: [{__typename: 'User', name: 'Ada'}]}})
      expect(data.me.friends[0]).not.toBe(data.me.friends[0])
      expect(data.me).not.toBe(data.me)
    })

    // With a per-operation identity cache, the same raw node hands back the SAME proxy —
    // both within a wrap and across wraps (consecutive renders read the same store data).
    const wrapCached = (data: any, cache: WeakMap<object, unknown>) =>
      wrapResult<any>(() => data, descriptor, undefined, undefined, undefined, undefined, undefined, () => cache)

    it('returns the SAME proxy for one node across repeated reads in a wrap', () => {
      const cache = new WeakMap<object, unknown>()
      const data = wrapCached({me: {__typename: 'User', friends: [{__typename: 'User', name: 'Ada'}]}}, cache)
      const first = data.me.friends[0]
      const second = data.me.friends[0]
      expect(first.name).toBe('Ada')
      expect(first).toBe(second)
      expect(data.me).toBe(data.me)
    })

    it('returns the SAME proxy for an unchanged raw node across re-wraps (renders)', () => {
      // The store keeps an untouched entity's object reference (structural sharing), so
      // two renders read the SAME raw node object → the shared cache hands back one proxy.
      const cache = new WeakMap<object, unknown>()
      const root = {me: {__typename: 'User', friends: [{__typename: 'User', name: 'Ada'}]}}
      const render1 = wrapCached(root, cache)
      const render2 = wrapCached(root, cache)
      expect(render1.me.friends[0]).toBe(render2.me.friends[0])
      expect(render1.me).toBe(render2.me)
    })

    it('gives a DIFFERENT proxy once the raw node is replaced (a real change)', () => {
      // A changed entity is a new raw object (immutable store write) → cache miss → new
      // proxy, so a `React.memo` correctly re-renders exactly the rows that changed.
      const cache = new WeakMap<object, unknown>()
      const v1 = {__typename: 'User', name: 'Ada'}
      const v2 = {__typename: 'User', name: 'Grace'}
      const a = wrapCached({me: v1}, cache).me
      const b = wrapCached({me: v2}, cache).me
      expect(a).not.toBe(b)
      expect(a.name).toBe('Ada')
      expect(b.name).toBe('Grace')
    })
  })
})
