// Test identity: headers → Principal. x-org → tenant; x-role/x-perm → RBAC/PBAC
// (comma lists); x-features (in pylon.config) → the tenant's feature plan.
import type {IdentityProvider} from '@getcronit/pylon-auth'

const list = (v?: string) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean)

export const headerAuth: IdentityProvider = c => {
  const id = c.req.header('x-user-id')
  if (!id) return undefined
  return {
    id,
    tenant: c.req.header('x-org') ?? 'orgA',
    roles: list(c.req.header('x-role')),
    permissions: list(c.req.header('x-perm'))
  }
}
