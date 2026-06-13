import {describe, expect, it} from 'vitest'
import {zitadelAuth} from '../src/zitadel'

/** Minimal Hono-context stub exposing only `get('auth')`. */
const ctx = (auth: unknown) => ({get: (k: string) => (k === 'auth' ? auth : undefined)}) as any

describe('zitadelAuth → IdentityProvider', () => {
  it('maps an OIDC AuthState to a Principal (sub→id, roles, claims→attributes)', () => {
    const provider = zitadelAuth()
    const p = provider(ctx({user: {sub: 'u_1', roles: ['admin'], email: 'a@b.c'}}))
    expect(p).toMatchObject({id: 'u_1', roles: ['admin'], permissions: []})
    expect((p!.attributes as any).email).toBe('a@b.c')
  })

  it('returns undefined for an unauthenticated request', () => {
    expect(zitadelAuth()(ctx(undefined))).toBeUndefined()
    expect(zitadelAuth()(ctx({}))).toBeUndefined() // no user
  })

  it('honors tenant/id/permissions mappers', () => {
    const provider = zitadelAuth({
      id: u => Number(u.sub),
      tenant: u => u['org_id'] as string,
      permissions: u => (u['perms'] as string[]) ?? []
    })
    const p = provider(ctx({user: {sub: '42', org_id: 'acme', perms: ['invoice:write']}}))
    expect(p).toMatchObject({id: 42, tenant: 'acme', permissions: ['invoice:write']})
  })
})
