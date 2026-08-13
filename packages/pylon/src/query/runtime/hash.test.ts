import {describe, expect, it} from 'vitest'
import {doc, opKey} from './doc'
import {stableStringify, variablesHash} from './hash'

describe('hash', () => {
  it('stableStringify is key-order independent', () => {
    expect(stableStringify({a: 1, b: 2})).toBe(stableStringify({b: 2, a: 1}))
  })

  it('variablesHash is deterministic and order-independent', () => {
    expect(variablesHash({x: 1, y: 2})).toBe(variablesHash({y: 2, x: 1}))
    expect(variablesHash(undefined)).toBe('0')
  })

  it('opKey combines document id and variables hash', () => {
    const d = doc({id: 'q_abc', body: '...', name: 'X'})
    expect(opKey(d, {a: 1})).toBe(`q_abc~${variablesHash({a: 1})}`)
    expect(opKey(d, {a: 1})).not.toBe(opKey(d, {a: 2}))
  })
})
