import {describe, expect, it} from 'vitest'
import {authorize, ForbiddenError, getPrincipal, hasPermission, hasRole, requireRole} from '@/auth/index'

describe('pylon-auth capability authz', () => {
  it('hasRole / hasPermission are null-safe ANY-of checks', () => {
    const p = {id: 1, roles: ['admin', 'user'], permissions: ['invoice:write']}
    expect(hasRole(p, 'admin')).toBe(true)
    expect(hasRole(p, 'editor', 'user')).toBe(true)
    expect(hasRole(p, 'nope')).toBe(false)
    expect(hasPermission(p, 'invoice:write')).toBe(true)
    expect(hasRole(undefined, 'admin')).toBe(false)
  })

  it('getPrincipal() is undefined outside a request (no throw)', () => {
    expect(getPrincipal()).toBeUndefined()
  })

  it('authorize throws ForbiddenError when the check fails, passes when it holds', () => {
    expect(() => authorize(() => true)).not.toThrow()
    expect(() => authorize(() => false)).toThrow(ForbiddenError)
    const err = (() => {
      try {
        authorize(() => false)
      } catch (e) {
        return e as ForbiddenError
      }
    })()
    expect(err?.code).toBe('FORBIDDEN')
    expect(err?.statusCode).toBe(403)
  })

  it('requireRole throws when the (here absent) principal lacks the role', () => {
    expect(() => requireRole('admin')).toThrow(ForbiddenError) // no principal bound → denied
  })
})
