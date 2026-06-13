import {describe, expect, it} from 'vitest'
// One import for backend batteries: the app/authz surface AND the re-exported ORM.
import {db, defineAbilities, hasPermission, hasRole, model, type Principal} from '../src/index'
import * as api from '../src/index'

describe('pylon-app surface', () => {
  it('re-exports the ORM (model) + abilities is the row-authz surface', () => {
    expect(typeof model).toBe('function')
    expect(typeof defineAbilities).toBe('function') // the single row-authz surface
    // The standalone `definePolicy` is collapsed — only the low-level db.definePolicy seam remains.
    expect(typeof db.definePolicy).toBe('function')
    expect('definePolicy' in api).toBe(false)
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
