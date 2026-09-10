/**
 * Global id codec — `gid://pylon/<Type>/<localId>` encode/decode + tolerant
 * input decoding. Pure unit tests (no DB); `resolveNode` dispatch is covered by
 * the integration suite.
 */
import {describe, expect, it} from 'vitest'
import {decodeId, fromGid, GID_NAMESPACE, isGid, setGidNamespace, toGid} from '@/db/gid'
import {snowflake} from '@/db/snowflake'

describe('gid codec', () => {
  it('round-trips type + local id', () => {
    const gid = toGid('Order', '123456789012345')
    expect(gid).toBe('gid://pylon/Order/123456789012345')
    const parsed = fromGid(gid)
    expect(parsed).toEqual({
      namespace: GID_NAMESPACE,
      type: 'Order',
      id: '123456789012345'
    })
  })

  it('accepts numeric and bigint local ids on encode', () => {
    expect(toGid('User', 42)).toBe('gid://pylon/User/42')
    expect(toGid('User', 42n)).toBe('gid://pylon/User/42')
  })

  it('round-trips a real snowflake id', () => {
    const id = snowflake({nodeId: 100})()
    expect(fromGid(toGid('Event', id)).id).toBe(id)
  })

  it('preserves a local id that itself contains slashes', () => {
    const gid = toGid('Blob', 'a/b/c')
    expect(fromGid(gid).id).toBe('a/b/c')
    expect(fromGid(gid).type).toBe('Blob')
  })

  it('rejects malformed gids', () => {
    expect(() => fromGid('not-a-gid')).toThrow(/Malformed global id/)
    expect(() => fromGid('gid://pylon')).toThrow(/Malformed/)
    expect(() => fromGid('gid://pylon/Order')).toThrow(/Malformed/)
    expect(() => fromGid('gid://pylon/Order/')).toThrow(/Malformed/)
    expect(() => fromGid('gid://pylon//123')).toThrow(/Malformed/)
    expect(() => fromGid('' as string)).toThrow(/Malformed/)
  })

  it('isGid guards without throwing', () => {
    expect(isGid('gid://pylon/Order/1')).toBe(true)
    expect(isGid('raw-id')).toBe(false)
    expect(isGid(123)).toBe(false)
    expect(isGid(null)).toBe(false)
  })
})

describe('decodeId (tolerant input)', () => {
  it('passes a bare id through unchanged', () => {
    expect(decodeId('raw-cuid-123')).toBe('raw-cuid-123')
    expect(decodeId('raw-cuid-123', 'Order')).toBe('raw-cuid-123')
  })

  it('strips a gid down to its local id', () => {
    expect(decodeId('gid://pylon/Order/999')).toBe('999')
  })

  it('validates the embedded type when expected', () => {
    expect(decodeId('gid://pylon/Order/999', 'Order')).toBe('999')
    expect(() => decodeId('gid://pylon/User/999', 'Order')).toThrow(
      /Expected a Order id but received a User id/
    )
  })
})

describe('setGidNamespace (useDatabase seam)', () => {
  it('changes the prefix toGid emits and isGid recognizes', () => {
    setGidNamespace('shop')
    try {
      expect(toGid('Order', '1')).toBe('gid://shop/Order/1')
      expect(isGid('gid://shop/Order/1')).toBe(true)
      expect(isGid('gid://pylon/Order/1')).toBe(false) // no longer the active ns
      // fromGid is namespace-agnostic (dispatch still works cross-namespace).
      expect(fromGid('gid://shop/Order/1')).toMatchObject({namespace: 'shop', type: 'Order'})
    } finally {
      setGidNamespace(GID_NAMESPACE) // restore default for other tests
    }
  })
})
