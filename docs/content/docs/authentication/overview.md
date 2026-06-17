---
title: Authentication
description: Bind a Principal with an identity provider, then gate with roles and capabilities — via @getcronit/pylon-auth.
section: Production
order: 1
nav: Authentication
---

Pylon's core is **auth-free**. Authentication lives in `@getcronit/pylon-auth`: an
**identity provider** turns a request into a `Principal`, and capability checks
(`requireRole`, `authorize`, `getPrincipal`) gate your resolvers and routes. Row-
level rules live one layer down in [abilities](/docs/data/policies).

## Bind an identity

`useIdentity` is a plugin that runs an identity provider per request and binds the
resulting `Principal`. A provider is just a function from the request context to a
`Principal` (or `undefined`):

```ts title="src/identity.ts"
import type {IdentityProvider} from '@getcronit/pylon-auth'

export const headerAuth: IdentityProvider = c => {
  const id = c.req.header('x-user-id')
  if (!id) return undefined
  return {
    id,
    tenant: c.req.header('x-org') ?? undefined,
    roles: [c.req.header('x-role') ?? 'user']
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

A `Principal` carries at least `id`, an optional `tenant`, and `roles`.

## OIDC with Zitadel

For a hosted login flow, use the Zitadel provider from the `/zitadel` subpath. One
plugin binds the principal; another adds the browser OAuth routes:

```ts title="pylon.config.ts"
import {useIdentity} from '@getcronit/pylon-auth'
import {zitadelAuth, zitadelLogin} from '@getcronit/pylon-auth/zitadel'

export default {
  plugins: [
    useIdentity(zitadelAuth({issuer: 'https://your-tenant.zitadel.cloud'})),
    zitadelLogin({issuer: 'https://your-tenant.zitadel.cloud'})
  ]
}
```

## Read and gate

Read the current principal anywhere with `getPrincipal()`, and gate with role and
capability helpers:

```ts
import {Pylon} from '@getcronit/pylon'
import {getPrincipal, requireRole} from '@getcronit/pylon-auth'

export default new Pylon({
  graphql: {
    Query: {
      me: () => {
        const p = getPrincipal()
        return p ? {id: p.id, roles: p.roles} : null
      }
    },
    Mutation: {
      // capability gate — throws ForbiddenError (→ 403) if the role is missing
      deleteEverything: () => {
        requireRole('admin')
        // ...
      }
    }
  }
})
```

Routes are gated the same way — a `Pylon` extends Hono, so `getPrincipal()` works
inside route handlers too:

```ts
app.get('/admin/export', c => {
  if (!hasRole(getPrincipal(), 'admin')) return c.json({error: 'Forbidden'}, 403)
  return c.json({ok: true})
})
```

## Connect to the data layer

Bind the data layer to the identity once, and everything downstream follows.
[`useDatabase()`](/docs/data/database) (bare) derives the connection and the
**tenant** from the bound `Principal`, so tenant scoping and
[row-level abilities](/docs/data/policies) apply automatically:

```ts title="pylon.config.ts"
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {headerAuth} from './src/identity'

export default {
  // identity first, then the database derives tenant/principal from it
  plugins: [useIdentity(headerAuth), useDatabase()]
}
```

This is the two-tier model: **capability** authz (roles/permissions, in
`pylon-auth`) guards _operations_; **resource** authz ([abilities](/docs/data/policies),
in `pylon-db`) guards _rows_. One `ForbiddenError` surfaces both as `403`.
