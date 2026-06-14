import {describe, expect, it} from 'vitest'
import {topoSortPlugins} from './plugin-order'
import type {Plugin} from '..'

const p = (name?: string, dependsOn?: string[]): Plugin => ({name, dependsOn}) as Plugin
const names = (ps: Plugin[]) => ps.map(x => x.name)

describe('topoSortPlugins', () => {
  it('preserves original order when nothing declares dependsOn (stable)', () => {
    const a = p('a'), b = p('b'), c = p('c')
    expect(names(topoSortPlugins([a, b, c]))).toEqual(['a', 'b', 'c'])
  })

  it('places a plugin AFTER its declared dependency, even if listed first', () => {
    const db = p('database', ['identity'])
    const id = p('identity')
    // database listed before identity, but depends on it → identity must come first
    expect(names(topoSortPlugins([db, id]))).toEqual(['identity', 'database'])
  })

  it('orders a chain identity → database → routes regardless of input order', () => {
    const routes = p('app-routes', ['database'])
    const db = p('database', ['identity'])
    const id = p('identity')
    expect(names(topoSortPlugins([routes, db, id]))).toEqual([
      'identity',
      'database',
      'app-routes'
    ])
  })

  it('ignores a dependency not present in the list (assumed satisfied elsewhere)', () => {
    const db = p('database', ['identity']) // no identity present
    const x = p('x')
    expect(names(topoSortPlugins([db, x]))).toEqual(['database', 'x']) // unchanged, no throw
  })

  it('keeps unconstrained plugins in place while moving only the constrained ones', () => {
    const s = p('sentry'), v = p('viewer'), db = p('database', ['identity']), id = p('identity')
    // sentry, viewer keep their lead; identity hoisted before database
    expect(names(topoSortPlugins([s, v, db, id]))).toEqual([
      'sentry',
      'viewer',
      'identity',
      'database'
    ])
  })

  it('throws a clear error on a dependency cycle', () => {
    const a = p('a', ['b']), b = p('b', ['a'])
    expect(() => topoSortPlugins([a, b])).toThrow(/cycle/i)
  })

  it('tolerates anonymous plugins (no name) — they keep their slot', () => {
    const anon = p(undefined)
    const id = p('identity')
    const db = p('database', ['identity'])
    expect(names(topoSortPlugins([anon, db, id]))).toEqual([
      undefined,
      'identity',
      'database'
    ])
  })
})
