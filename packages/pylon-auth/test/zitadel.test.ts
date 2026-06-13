import {describe, expect, it} from 'vitest'
import {zitadelAuth, zitadelPrincipal} from '../src/zitadel'

describe('zitadelPrincipal (claims → Principal mapping)', () => {
  it('maps sub→id, roles, and claims→attributes by default', () => {
    const p = zitadelPrincipal('u_1', ['admin'], {sub: 'u_1', email: 'a@b.c'} as any, {
      issuer: 'x'
    })
    expect(p).toMatchObject({id: 'u_1', roles: ['admin'], permissions: []})
    expect((p.attributes as any).email).toBe('a@b.c')
  })

  it('honors id/tenant/permissions mappers', () => {
    const p = zitadelPrincipal(
      '42',
      [],
      {sub: '42', org_id: 'acme', perms: ['invoice:write']} as any,
      {
        issuer: 'x',
        id: u => Number(u.sub),
        tenant: u => u['org_id'] as string,
        permissions: u => (u['perms'] as string[]) ?? []
      }
    )
    expect(p).toMatchObject({id: 42, tenant: 'acme', permissions: ['invoice:write']})
  })
})

describe('zitadelAuth IdentityProvider', () => {
  it('returns undefined for an unauthenticated request (no token, no network)', async () => {
    const provider = zitadelAuth({issuer: 'https://example.zitadel.cloud'})
    const c = {
      req: {header: () => undefined, query: () => undefined, raw: {headers: new Headers()}}
    } as any
    await expect(provider(c)).resolves.toBeUndefined()
  })
})
