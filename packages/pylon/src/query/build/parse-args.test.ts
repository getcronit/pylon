import {describe, expect, it} from 'vitest'
import {parseArgs} from './parse-args'

describe('parseArgs', () => {
  it('parses a simple object literal', () => {
    expect(parseArgs('{ first: 10, after: cursor }')).toEqual({
      first: '10',
      after: 'cursor'
    })
  })

  it('parses shorthand properties', () => {
    expect(parseArgs('{ id }')).toEqual({id: 'id'})
  })

  it('keeps nested objects intact as the value', () => {
    expect(parseArgs('{ where: { name: x }, first: 5 }')).toEqual({
      where: '{ name: x }',
      first: '5'
    })
  })

  it('preserves ternaries in values (first top-level colon wins)', () => {
    expect(parseArgs('{ first: cond ? 1 : 2 }')).toEqual({
      first: 'cond ? 1 : 2'
    })
  })

  it('handles string literals containing commas and colons', () => {
    expect(parseArgs('{ q: "a, b: c", n: 1 }')).toEqual({
      q: '"a, b: c"',
      n: '1'
    })
  })

  it('returns {} for empty args', () => {
    expect(parseArgs('{}')).toEqual({})
    expect(parseArgs('')).toEqual({})
  })

  it('bails (null) on a bare identifier we cannot map', () => {
    expect(parseArgs('myArgs')).toBeNull()
  })

  it('bails on spread args', () => {
    expect(parseArgs('{ ...rest, first: 1 }')).toBeNull()
  })
})
