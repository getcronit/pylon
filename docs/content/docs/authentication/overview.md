---
title: Authentication
nav: Overview
description: Bind a Principal per request with an identity provider, then gate operations with roles and capabilities.
section: Authentication
order: 0
---

Pylon's runtime is **auth-free**. The framework never assumes who you are — identity
lives entirely in `@getcronit/pylon-auth`. You bind a `Principal` per request with a
single plugin, then read it and gate on it anywhere. **Capability** authz answers
*who you are* (roles, permissions); **resource** authz answers *what rows and fields
you may touch*. This page covers the first. The second lives one layer down in the
data layer — see [policies](/docs/data/policies) and [multi-tenancy](/docs/data/multi-tenancy).

## The Principal

Every request resolves to one `Principal` — or to nobody. The shape is small and
flat:

```ts
type Principal = {
  id: string
  tenant?: string
  roles?: string[]
  permissions?: string[]
  attributes?: Record<string, unknown>
}
```

An `IdentityProvider` is a function from the request context to a `Principal`.
Returning `undefined` means **anonymous** — no principal is bound, and capability
checks treat the request as unauthenticated:

```ts
type IdentityProvider = (c: Context) => Principal | undefined
```

## Bind an identity

`useIdentity(provider)` is a plugin. It runs your provider once per request and
binds the result for the lifetime of that request. The simplest provider reads
trusted headers:

```ts title="src/identity.ts"
import type {IdentityProvider} from '@getcronit/pylon-auth'

export const headerAuth: IdentityProvider = c => {
  const id = c.req.header('x-user-id')
  if (!id) return undefined // anonymous
  return {
    id,
    tenant: c.req.header('x-org') ?? undefined,
    roles: (c.req.header('x-roles') ?? 'user').split(',')
  }
}
```

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon-auth'
import {headerAuth} from './src/identity'

export default {
  plugins: [useIdentity(headerAuth)]
} satisfies PylonConfig
```

## OIDC with Zitadel

For a real login flow, use the Zitadel provider from the `/zitadel` subpath. One
plugin verifies the incoming token and binds the `Principal`; the other mounts the
browser OAuth routes:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon-auth'
import {zitadelAuth, zitadelLogin} from '@getcronit/pylon-auth/zitadel'

const issuer = 'https://your-tenant.zitadel.cloud'

export default {
  plugins: [
    useIdentity(zitadelAuth({issuer})),
    zitadelLogin({issuer})
  ]
} satisfies PylonConfig
```

`zitadelAuth` maps verified OIDC claims onto the `Principal` — subject to `id`,
the organization to `tenant`, and granted roles to `roles`. That mapping is exposed
on its own as `zitadelPrincipal(sub, roles, user, options)`, which builds a
`Principal` from raw claims with no OIDC server involved — handy for unit tests or a
custom token flow:

```ts
import {zitadelPrincipal} from '@getcronit/pylon-auth/zitadel'

const principal = zitadelPrincipal('user-1', ['admin'], oidcUser, {issuer})
```

## Read the principal

Read the current principal anywhere — resolvers, route handlers, downstream
helpers — with `getPrincipal()`:

```ts
import {Pylon} from '@getcronit/pylon'
import {getPrincipal} from '@getcronit/pylon-auth'

export default new Pylon({
  graphql: {
    Query: {
      me: () => {
        const p = getPrincipal()
        return p ? {id: p.id, roles: p.roles ?? []} : null
      }
    }
  }
})
```

## Gate on capabilities

Capability checks throw a `ForbiddenError` (GraphQL code `FORBIDDEN`, HTTP `403`)
when they fail — no manual error handling required.

- `requireRole(...roles)` — passes if the principal has **any** of the given roles.
- `authorize(check)` — runs a predicate over the principal; throws on `false`.
- `hasRole(p, ...roles)` / `hasPermission(p, ...perms)` — boolean tests, for
  branching rather than throwing.

```ts
import {Pylon} from '@getcronit/pylon'
import {
  getPrincipal,
  authorize,
  requireRole,
  hasPermission
} from '@getcronit/pylon-auth'

export default new Pylon({
  graphql: {
    Mutation: {
      // any-of role check — throws ForbiddenError if neither role is present
      publishPost: (id: string) => {
        requireRole('editor', 'admin')
        return publish(id)
      },
      // predicate check — full access to the principal
      deleteAccount: (id: string) => {
        authorize(p => p?.id === id || hasPermission(p, 'accounts:delete'))
        return remove(id)
      }
    }
  }
})
```

Because a `Pylon` extends Hono, the same helpers work inside route handlers:

```ts
import {getPrincipal, hasRole} from '@getcronit/pylon-auth'

app.get('/admin/export', c => {
  if (!hasRole(getPrincipal(), 'admin')) return c.json({error: 'forbidden'}, 403)
  return c.json({ok: true})
})
```

:::tip
Keep providers thin. A provider's only job is to turn a verified request into a
`Principal`. All gating logic lives in your resolvers and routes, where it's close
to the operation it protects.
:::

## Capability authz vs. resource authz

These two layers are distinct, and you'll usually use both:

| | Capability authz | Resource authz |
|---|---|---|
| Question | *Who are you?* | *What may you touch?* |
| Granularity | Operations (a mutation, a route) | Rows and fields |
| Lives in | `@getcronit/pylon-auth` (this page) | `@getcronit/pylon-db` |
| Tools | `requireRole`, `authorize`, `hasRole` | [policies](/docs/data/policies), [multi-tenancy](/docs/data/multi-tenancy) |

The two connect through the `Principal`. Once `useIdentity` binds it, the data
layer derives the current tenant and applies row-level policies automatically —
both layers surface a single `ForbiddenError` as a `403`.

:::tip[Related guide]
Put it together in [Role-Based Access Control](/docs/guides/role-based-access-control) — roles, gates, and ability-scoped queries end to end.
:::
