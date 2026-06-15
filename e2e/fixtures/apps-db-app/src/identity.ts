// Test identity: headers → Principal. x-org drives ORM tenant scoping; x-role
// drives the app's capability gate.
import type {IdentityProvider} from '@getcronit/pylon-auth'

export const headerAuth: IdentityProvider = c => {
  const id = c.req.header('x-user-id')
  if (!id) return undefined // public request
  return {
    id,
    tenant: c.req.header('x-org') ?? 'orgA',
    roles: (c.req.header('x-role') ?? 'user').split(',')
  }
}
