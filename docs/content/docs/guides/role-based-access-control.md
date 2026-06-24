---
title: Role-Based Access Control
nav: RBAC
description: Wire roles end to end — bind them on the Principal, gate operations by capability, then auto-scope rows by ability.
section: Guides
order: 2
---

RBAC in Pylon spans two tiers that share one `Principal`. **Capability** authz
answers *who you are* — roles and permissions on an operation. **Resource** authz
answers *what rows you may touch* — conditions folded into every query. This guide
wires both: an identity provider that puts `roles` on the principal, capability
gates that deny a mutation, an app-level gate, and abilities that auto-scope a
query so an author only ever sees their own posts.

## 1. Put roles on the Principal

Identity lives in `@getcronit/pylon-auth`. An `IdentityProvider` turns a request
into a `Principal`; returning `undefined` means anonymous. Read `roles` off a
trusted header (in production this comes from a verified token):

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

Bind it with the `useIdentity` plugin:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {headerAuth} from './src/identity'

export default {
  plugins: [useIdentity(headerAuth), useDatabase()]
} satisfies PylonConfig
```

`useDatabase()` defaults its principal off the bound identity, so the resource
tier picks up the same roles with no extra wiring.

## 2. Gate an operation by capability

Capability checks throw a `ForbiddenError` (GraphQL code `FORBIDDEN`, HTTP `403`)
when they fail — no manual error handling. `requireRole(...roles)` passes if the
principal has **any** of the given roles; `hasRole(p, ...roles)` is the boolean
form for branching:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {requireRole, hasRole, getPrincipal} from '@getcronit/pylon-auth'

export default new Pylon({
  graphql: {
    Mutation: {
      // throws ForbiddenError unless the caller is an editor or admin
      publishPost: (id: string) => {
        requireRole('editor', 'admin')
        return publish(id)
      }
    },
    Query: {
      // branch without throwing
      auditLog: () => (hasRole(getPrincipal(), 'admin') ? readAuditLog() : [])
    }
  }
})
```

A request without the `editor` or `admin` role calling `publishPost` gets a
`403` before `publish` ever runs.

## 3. Gate a whole app

When you compose features as separate `Pylon` apps, each carries a `gate` — a
capability check that runs before any of its resolvers. The `gate({authorize})`
helper from `@getcronit/pylon-db` builds one from a principal predicate:

```ts title="src/apps/admin.ts"
import {Pylon} from '@getcronit/pylon'
import {gate} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'

export const admin = new Pylon({
  graphql: {Query: {users: () => listUsers()}},
  gate: gate({authorize: p => hasRole(p, 'admin')})
})
```

Compose it at the root and the gate covers every resolver the app contributes:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {admin} from './apps/admin'
import {blog} from './apps/blog'

export default Pylon.compose(admin, blog)
```

A non-admin hitting any `admin` field gets a `ForbiddenError`. A failing gate is
the coarse cut — it never runs the resolver, so it pairs naturally with the
fine-grained row rules below.

## 4. Auto-scope rows by ability

The resource tier lives in the ORM. Declare a model's row-level rules right on the
model with **`static abilities`** — the subject is implicit, so there's no model
argument to keep in sync. A row condition you attach to `can('read', ...)` is
AND-ed into **every** read of that model — queries, relation loads, paginations.
Forget a `WHERE` clause in a resolver and the rule still applies.

```ts title="src/apps/blog/models.ts"
import {Model, manager, id, text} from '@getcronit/pylon-db'
import {blog} from './index'

@blog.model()
export class Post extends Model {
  static objects = manager(Post)
  id = id()
  title = text()
  authorId = text()

  static abilities(p: {id?: string} | undefined, can) {
    // a row condition AND-ed into every read of Post
    can('read', {authorId: p?.id})
    can('update', {authorId: p?.id})
    can('delete', {authorId: p?.id})

    // stamp ownership on create so a client can't spoof authorId
    if (p) can('create').stamp(post => { post.authorId = String(p.id) })
  }
}
```

Cross-cutting rules — ones that span models or grant across the board, like
giving an admin everything — go on the app via the constructor's
`models.abilities` config, where the subject is named explicitly:

```ts title="src/apps/blog/index.ts"
import {Pylon} from '@getcronit/pylon'
import {hasRole} from '@getcronit/pylon-auth'

export const blog = new Pylon({
  name: 'blog',
  models: {
    // admins do anything, across every model in the app
    abilities(p, can) {
      if (hasRole(p, 'admin')) can('manage', 'all')
    }
  }
})
```

Both sets compose, and both are harvested into the IR. Now the read resolver
stays clean — the scope applies implicitly:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {Post} from './models'

export default new Pylon({
  graphql: {
    Query: {
      // returns only the caller's posts (admins see all)
      myPosts: () => Post.objects.all()
    }
  }
})
```

A regular author calling `myPosts` gets only rows where `authorId` matches their
`id`. An admin gets everything — the `can('manage', 'all')` grant wins. Neither
resolver mentions the principal.

For a write, enforce the rule on a specific instance with `authorize`. It throws
`ForbiddenError` if the principal isn't allowed:

```ts title="src/index.ts"
import {authorize} from '@getcronit/pylon-db'

const renamePost = async (id: number, title: string) => {
  const post = await Post.objects.get({id})
  authorize('update', post) // ForbiddenError unless owner or admin
  post.title = title
  await post.$save()
  return post
}
```

:::tip
The two tiers compose: the app `gate` denies the *operation* for non-admins,
while abilities scope the *rows* for everyone who gets through. Both surface a
single `ForbiddenError` as a `403`.
:::

The capability layer is detailed in
[Authentication](/docs/authentication/overview); the resource layer, including
`secure` deny-by-default and the low-level `db.definePolicy` seam, is in
[Authorization Policies](/docs/data/policies).
