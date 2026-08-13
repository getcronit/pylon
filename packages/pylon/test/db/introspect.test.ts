import {describe, expect, it} from 'vitest'
import {computeDrift, hasDrift} from '../src/introspect'

describe('computeDrift — presence-level (tables + columns)', () => {
  it('reports missing/extra tables and per-table column drift', () => {
    const expected = new Map([
      ['user', new Set(['id', 'email'])],
      ['post', new Set(['id'])]
    ])
    const actual = new Map([
      ['user', new Set(['id'])], // missing email
      ['legacy', new Set(['x'])] // not in models
    ])
    const d = computeDrift(actual, expected)
    expect(d.missingTables).toEqual(['post'])
    expect(d.extraTables).toEqual(['legacy'])
    expect(d.columns).toEqual([{table: 'user', missing: ['email'], extra: []}])
    expect(hasDrift(d)).toBe(true)
  })

  it('no drift when the DB matches the models', () => {
    const same = () => new Map([['user', new Set(['id', 'email'])]])
    expect(hasDrift(computeDrift(same(), same()))).toBe(false)
  })
})
