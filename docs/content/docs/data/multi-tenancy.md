---
title: Multi-tenancy & Features
description: Automatic tenant scoping and feature gating that apply across every query and resolver.
section: Data — pylon-db
order: 7
---

Pylon ORM has first-class support for multi-tenant applications. Tenant scoping
and feature flags are bound once per request and applied automatically to every
query — no manual `WHERE tenantId = ...` anywhere.

## App context

The ambient context for a request (or background job) holds the `tenant`,
`features`, and `principal`. You set it with `runWithAppContext`:

```ts
import {runWithAppContext} from '@getcronit/pylon-db'

await runWithAppContext({tenant: 'org-A', features: ['shop']}, async () => {
  // every query in here is scoped to org-A
  const widgets = await Widget.objects.all()
})
```

In a Pylon app you rarely set this by hand. Bind an
[identity](/docs/authentication/overview) and a **bare** `useDatabase()` derives
the tenant and principal from it automatically:

```ts title="pylon.config.ts"
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {headerAuth} from './src/identity'

// identity first; the database derives tenant + principal from the Principal
export default {plugins: [useIdentity(headerAuth), useDatabase()]}
```

Read the current values anywhere with `currentTenant()`, `currentFeatures()`,
and `currentPrincipal()`.

## Tenant auto-scoping

Declare which column carries the tenant id, and Pylon stamps it on insert and
filters by it on every read:

```ts
import {models, manager} from '@getcronit/pylon-db'

const shop = models.app('shop', {tenant: 'orgId'})

@shop.model()
class Widget extends shop.Model {
  static objects = manager(Widget)
  id = shop.ID()
  orgId = shop.Text() // the tenant column
  name = shop.Text()
}
```

Now scoping is automatic:

```ts
await runWithAppContext({tenant: 'org-A'}, async () => {
  const w = await Widget.objects.create({name: 'a1'})
  w.orgId // 'org-A' — stamped from the ambient tenant

  await Widget.objects.all()   // only org-A's rows
  await Widget.objects.count() // only org-A's rows
})
```

If a query runs against a tenant-scoped model with no tenant bound, it throws —
so you can never accidentally leak across tenants. Trusted code can cross tenants
explicitly with `unscoped()`:

```ts
await Widget.objects.unscoped().all() // every tenant's rows
```

## Feature flags

Define a typed set of features, then gate code on them:

```ts
import {defineFeatures, requireFeature} from '@getcronit/pylon-db'

const FEATURES = defineFeatures(['shop', 'billing'] as const)

// throws ForbiddenError if the feature isn't enabled for this request
requireFeature(FEATURES.shop)
```

An app can declare the feature it requires; gate individual resolvers with
`requireFeature`:

```ts
const shop = models.app('shop', {tenant: 'orgId', feature: FEATURES.shop})

new Pylon({
  graphql: {
    Query: {
      widgets: () => {
        requireFeature(FEATURES.shop) // ForbiddenError if the tenant lacks it
        return Widget.objects.all()
      }
    }
  }
})
```

The active feature set comes from the bound identity automatically — so a tenant
without `shop` enabled simply can't reach shop functionality.
