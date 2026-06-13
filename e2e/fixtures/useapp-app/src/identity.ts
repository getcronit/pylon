// Test identity provider: a request's headers → a Principal. Mirrors how a real
// app (e.g. lokalis) maps its own session/JWT to the standard Principal — the
// ONE seam. x-user-id/x-org/x-role stand in for "resolve the session".
import type {IdentityProvider} from '@getcronit/pylon-app'

export const headerAuth: IdentityProvider = c => {
  const id = c.req.header('x-user-id')
  if (!id) return undefined // public request
  return {
    id,
    tenant: c.req.header('x-org') ?? 'orgA', // drives ORM tenant auto-scoping
    roles: [c.req.header('x-role') ?? 'user']
  }
}
