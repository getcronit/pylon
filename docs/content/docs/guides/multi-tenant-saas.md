---
title: Multi-Tenant SaaS
description: Combine tenancy, identity, abilities, and apps so every request is scoped to its org automatically — with no manual filters.
section: Guides
order: 1
---

A multi-tenant SaaS shares one database across many organizations, and the cost
of a single missing `WHERE orgId = ...` is a cross-tenant data leak. Pylon moves
tenant scoping and authorization **out of your resolvers and into the data
layer**, so a request is bound to its org once and every query is scoped from
there. This recipe wires identity, tenancy, row-level abilities, and app
composition into a coherent whole.

## The shape of the solution

Four pieces compose:

- **Identity** binds a `Principal` per request — including which `tenant` it
  belongs to.
- **A bare `useDatabase()`** derives the tenant from that `Principal`, so every
  query is automatically scoped.
- **`models.app(name, {tenant, secure})`** declares the tenant column and turns
  on deny-by-default authorization for a feature's models.
- **`defineAbilities`** adds row-level rules; **`gate`** adds capability checks at
  the app boundary.

Define each feature as its own `Pylon`, then `compose` them at the root.

## 1. Bind the identity

An identity provider turns a verified request into a `Principal`. Crucially, it
sets `tenant` — that single field is what scopes the entire request.

```ts title="src/identity.ts"
import type {IdentityProvider} from '@getcronit/pylon-auth'

export const headerAuth: IdentityProvider = c => {
  const id = c.req.header('x-user-id')
  if (!id) return undefined // anonymous
  return {
    id,
    tenant: c.req.header('x-org') ?? undefined, // ← the org this request acts as
    roles: (c.req.header('x-roles') ?? 'member').split(',')
  }
}
```

## 2. A tenant-scoped, secure app

`models.app('projects', {tenant: 'orgId', secure: true})` declares two things:
the `orgId` column carries the tenant, and `secure: true` makes the app
deny-by-default — any action without a matching `can(...)` rule is rejected.

```ts title="apps/projects.ts"
import {Pylon} from '@getcronit/pylon'
import {db, models, gate} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'

const projects = models.app('projects', {tenant: 'orgId', secure: true})

@projects.model() // → table "projects_task"
export class Task extends projects.Model {
  static objects = db.manager(Task)
  id = projects.ID()
  orgId = projects.Text()   // tenant column — stamped automatically
  ownerId = projects.Text() // stamped by an ability (below)
  title = projects.Text()
  done = projects.Boolean({default: false})
}

export const projectsApp = new Pylon({
  // capability gate at the app boundary: must be a signed-in member
  gate: gate({authorize: p => hasRole(p, 'member', 'admin')}),
  graphql: {
    Query: {
      // no manual filter — scoped to this org AND to readable rows
      tasks: (): Promise<Task[]> => Task.objects.all()
    },
    Mutation: {
      addTask: (title: string): Promise<Task> => Task.objects.create({title})
    }
  }
})
```

Notice the resolvers contain **no tenancy or ownership logic**. `Task.objects.all()`
returns only the current org's rows, and `create({title})` stamps `orgId` from the
ambient tenant — both happen in the data layer.

## 3. Row-level abilities

`defineAbilities` adds resource authz on top of tenant scoping: who can read or
write which rows, and which server-owned fields get stamped on create.

```ts title="apps/projects.ts"
import {defineAbilities} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'

defineAbilities((principal, can) => {
  if (hasRole(principal, 'admin')) can('manage', 'all')

  const uid = principal?.id ?? '__anon__'

  // members read tasks they own; update only their own
  can('read', Task, {ownerId: uid})
  can('update', Task, {ownerId: uid})

  // stamp ownership on create so clients can't spoof it
  if (principal) {
    can('create', Task).stamp(t => {
      t.ownerId = String(principal.id)
    })
  }
})
```

Reads filter automatically; for writes, call `authorize('update', task)` in a
resolver to enforce the rule on a specific instance. See
[Authorization](/docs/data/policies).

## 4. Compose apps at the root

Each app is self-contained — its own models, resolvers, gate, and tenant config.
The root `Pylon` merges them into **one schema served at one `/graphql`**.

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {projectsApp} from './apps/projects'
import {billingApp} from './apps/billing'

export default new Pylon().compose(projectsApp, billingApp)
```

Add the plugins — identity first, then a **bare** `useDatabase()` that derives the
tenant and principal from the bound `Principal`:

```ts title="pylon.config.ts"
import {serve} from '@hono/node-server'
import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {headerAuth} from './src/identity'

export default {
  plugins: [
    useIdentity(headerAuth), // binds the Principal (incl. tenant)
    useDatabase(),           // derives tenant + principal from it
    {
      name: 'serve',
      strategy: 'last',
      setup: app => serve({fetch: app.fetch, port: Number(process.env.PORT) || 3000})
    }
  ]
} satisfies PylonConfig
```

## What a request looks like end to end

Trace one request through the stack to see why no manual scoping is needed:

1. `useIdentity` runs `headerAuth`, binding `{id, tenant: 'org-A', roles}`.
2. `useDatabase` reads that `Principal` and binds `tenant: 'org-A'` to the request.
3. The app's `gate` runs `authorize` — rejects with `403` if the caller isn't a
   member.
4. `Task.objects.all()` resolves with an implicit `WHERE orgId = 'org-A'` **and**
   the `read` ability's `ownerId` condition.
5. `Task.objects.create({title})` stamps `orgId = 'org-A'` and the `create`
   ability stamps `ownerId`.

If a tenant-scoped query ever runs with no tenant bound, it **throws** rather than
returning every org's rows — so a forgotten scope fails loudly instead of leaking.

## Feature flags per tenant

Tenants on different plans see different surfaces. Declare a feature on an app and
gate resolvers with `requireFeature`; the active feature set comes from the bound
identity automatically.

```ts title="apps/billing.ts"
import {defineFeatures, requireFeature, models, gate} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'

const FEATURES = defineFeatures(['billing'] as const)
const billing = models.app('billing', {tenant: 'orgId', feature: FEATURES.billing})

export const billingApp = new Pylon({
  gate: gate({authorize: p => hasRole(p, 'admin'), feature: FEATURES.billing}),
  graphql: {
    Query: {
      invoices: () => {
        requireFeature(FEATURES.billing) // ForbiddenError if the tenant lacks it
        return Invoice.objects.all()
      }
    }
  }
})
```

A tenant without `billing` enabled simply can't reach billing functionality — the
gate throws a `403` before any resolver runs.

## Test setup bypasses scoping

Tenancy makes seeding awkward — a fixture has no request, so no tenant is bound.
Run setup with `runAsSystem` (full access) and `unscoped()` (skip tenant scoping):

```ts
import {runAsSystem} from '@getcronit/pylon-db'

await runAsSystem(async () => {
  await Task.objects.unscoped().create({orgId: 'org-A', ownerId: 'u1', title: 'seed'})
})
```

See [Testing](/docs/guides/testing) for the full pattern.

## Where to go next

- [Apps](/docs/apps/overview) — the composition model in depth.
- [Multi-tenancy & Features](/docs/data/multi-tenancy) — tenant scoping and
  feature flags.
- [Authorization](/docs/data/policies) — abilities, `stamp`, and `runAsSystem`.
- [Authentication](/docs/authentication/overview) — providers, OIDC, and the
  `Principal`.
