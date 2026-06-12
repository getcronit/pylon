import {describe, expect, it} from 'vitest'
// One import for backend batteries: the app/authz surface AND the re-exported ORM.
import {hasPermission, hasRole, model, definePolicy, type Principal} from '../src/index'

describe('pylon-app surface', () => {
  it('re-exports the ORM (model, definePolicy) alongside the app surface', () => {
    expect(typeof model).toBe('function')
    expect(typeof definePolicy).toBe('function')
  })

  it('Principal helpers are null-safe RBAC/PBAC checks', () => {
    const admin: Principal = {id: 1, roles: ['admin', 'user'], permissions: ['invoice:write']}
    expect(hasRole(admin, 'admin')).toBe(true)
    expect(hasRole(admin, 'editor', 'user')).toBe(true) // ANY-of
    expect(hasRole(admin, 'nope')).toBe(false)
    expect(hasPermission(admin, 'invoice:write')).toBe(true)
    expect(hasPermission(admin, 'invoice:delete')).toBe(false)
    // public (undefined) principal → everything false, no throw
    expect(hasRole(undefined, 'admin')).toBe(false)
    expect(hasPermission(undefined, 'invoice:write')).toBe(false)
  })
})
