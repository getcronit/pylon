import {describe, expect, it} from 'vitest'
import {Gid} from './gid'

describe('Gid', () => {
  const str = 'gid://pylon/Ticket/1780219977399508992'

  it('parses parts on construction (throws on a bad gid, like new URL)', () => {
    const g = new Gid(str)
    expect(g.namespace).toBe('pylon')
    expect(g.type).toBe('Ticket')
    expect(g.id).toBe('1780219977399508992')
    expect(() => new Gid('1780219977399508992')).toThrow(/Invalid gid/)
    expect(() => new Gid('' as string)).toThrow(/Invalid gid/)
  })

  it('toString / toJSON reconstruct the canonical gid', () => {
    const g = new Gid(str)
    expect(g.toString()).toBe(str)
    expect(JSON.stringify({id: g})).toBe(JSON.stringify({id: str}))
  })

  it('parse is null-safe (like URL.parse) and idempotent on a Gid', () => {
    expect(Gid.parse('raw-cuid')).toBeNull()
    expect(Gid.parse(123 as unknown)).toBeNull()
    expect(Gid.parse(null)).toBeNull()
    const g = new Gid(str)
    expect(Gid.parse(g)).toBe(g)
    expect(Gid.parse(str)?.type).toBe('Ticket')
  })

  it('Gid.id returns the local id — tolerant no-op on raw ids (routing)', () => {
    expect(Gid.id(str)).toBe('1780219977399508992')
    expect(Gid.id('raw-cuid-abc')).toBe('raw-cuid-abc') // no-op when globalIds off
  })

  it('Gid.from rebuilds from parts (default + custom namespace)', () => {
    expect(Gid.from('Ticket', '1780219977399508992').toString()).toBe(str)
    expect(Gid.from('Order', '5', 'acme').toString()).toBe('gid://acme/Order/5')
  })

  it('preserves a local id that contains slashes', () => {
    const g = new Gid('gid://acme/Blob/a/b/c')
    expect(g.type).toBe('Blob')
    expect(g.id).toBe('a/b/c')
    expect(g.toString()).toBe('gid://acme/Blob/a/b/c')
  })

  it('Gid.is guards without throwing', () => {
    expect(Gid.is(str)).toBe(true)
    expect(Gid.is('raw')).toBe(false)
    expect(Gid.is(null)).toBe(false)
  })

  it('parses ANY namespace without configuration', () => {
    // reconstruction default is 'pylon', but parsing reads the namespace out
    expect(new Gid('gid://lokalis/Ticket/5').namespace).toBe('lokalis')
    expect(Gid.id('gid://lokalis/Ticket/5')).toBe('5')
  })

  it('Gid.configure sets the namespace Gid.from rebuilds with', () => {
    expect(Gid.defaultNamespace).toBe('pylon')
    expect(Gid.from('Ticket', '5').toString()).toBe('gid://pylon/Ticket/5')
    try {
      Gid.configure({namespace: 'lokalis'})
      expect(Gid.defaultNamespace).toBe('lokalis')
      expect(Gid.from('Ticket', '5').toString()).toBe('gid://lokalis/Ticket/5')
      // explicit arg still overrides the default
      expect(Gid.from('Ticket', '5', 'other').toString()).toBe('gid://other/Ticket/5')
    } finally {
      Gid.configure({namespace: 'pylon'}) // restore for other tests
    }
  })
})
