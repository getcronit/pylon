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
import {mergeResolverMaps} from './pylon-handler'

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
