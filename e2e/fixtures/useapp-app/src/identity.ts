import type {IdentityProvider} from '@getcronit/pylon/auth'

export const headerAuth: IdentityProvider = c => {
  const id = c.req.header('x-user-id')
  if (!id) return undefined
  return {
    id,
    tenant: c.req.header('x-org') ?? 'orgA',
    roles: [c.req.header('x-role') ?? 'user']
  }
}
