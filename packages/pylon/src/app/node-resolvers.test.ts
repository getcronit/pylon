/**
 * `mergeResolverMaps` — the one-level-deep merge that lets the build-injected
 * global-id resolvers (`Query.node` + per-type `id`) coexist with the app's own
 * `Query`/`Mutation`/entity resolvers instead of replacing the whole type object.
 *
 * (Execution through a live schema is covered end-to-end elsewhere: the pylon-dev
 * `orm-global-ids` build test proves the emitted `id`→gid encoders + `Query.node`,
 * and the pylon-db `resolveNode` integration test proves dispatch against a DB.)
 */
import {describe, expect, it} from 'vitest'
import {decodeGidInput, mergeResolverMaps} from './pylon-handler'

describe('mergeResolverMaps', () => {
  it('merges same-type fields one level deep (b wins on conflict)', () => {
    const merged = mergeResolverMaps(
      {Query: {product: 'user', shared: 'user'}, User: {x: 1}},
      {Query: {node: 'build', shared: 'build'}, Post: {y: 2}}
    )
    // User's Query.product survives; build's Query.node is added; conflict → build.
    expect(merged).toEqual({
      Query: {product: 'user', node: 'build', shared: 'build'},
      User: {x: 1},
      Post: {y: 2}
    })
  })

  it('replaces (does not merge) when a side is not a plain object', () => {
    expect(mergeResolverMaps({Date: {a: 1}}, {Date: 'scalar'})).toEqual({Date: 'scalar'})
    expect(mergeResolverMaps({}, {Query: {node: 1}})).toEqual({Query: {node: 1}})
    expect(mergeResolverMaps({Query: {a: 1}}, {})).toEqual({Query: {a: 1}})
  })
})

describe('decodeGidInput (the ID scalar boundary decode)', () => {
  it('strips a gid to its raw local id', () => {
    expect(decodeGidInput('gid://pylon/Note/12345')).toBe('12345')
    expect(decodeGidInput('gid://shop/Product/abc-def')).toBe('abc-def')
  })

  it('passes a raw local id (snowflake, cuid, uuid, int) through untouched', () => {
    expect(decodeGidInput('867530999999')).toBe('867530999999')
    expect(decodeGidInput('p0cbf9qq3m8ou7je2yvpz4t7')).toBe('p0cbf9qq3m8ou7je2yvpz4t7')
    expect(decodeGidInput(42)).toBe(42)
  })

  it('leaves non-gid strings and non-strings alone', () => {
    expect(decodeGidInput('not-a-gid')).toBe('not-a-gid')
    expect(decodeGidInput(null)).toBeNull()
    expect(decodeGidInput(undefined)).toBeUndefined()
  })
})
