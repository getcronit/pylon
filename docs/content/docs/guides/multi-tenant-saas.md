---
title: Building a Multi-tenant SaaS
description: Combine tenant scoping, row-level policies, and feature flags into a safe multi-tenant data layer.
section: Guides
order: 3
---

Multi-tenant SaaS is where Pylon's data layer earns its keep. Tenant isolation,
per-user authorization, and plan-based feature gating all live at the data layer,
so they apply to every query automatically — you can't forget them in a resolver.

This guide wires the three together.

## 1. Scope models to a tenant

Declare the tenant column on an [app](/docs/apps/overview) (or a model), and Pylon
stamps it on insert and filters by it on every read:

```ts
import {db, models} from '@getcronit/pylon-db'

// secure: deny-by-default; tenant: auto-scope every query by orgId
const core = models.app('core', {tenant: 'orgId', feature: 'core', secure: true})

@core.model()
class Project extends core.Model {
  static objects = db.manager(Project)
  id = core.ID()
  orgId = core.Text()  // tenant column
  name = core.Text()
  ownerId = core.Text()
}
```

## 2. Authorize within the tenant

Tenant scoping isolates organizations; [abilities](/docs/data/policies) control
what a user can see and do inside their org:

```ts
import {defineAbilities} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'

defineAbilities((principal, can) => {
  const uid = principal?.id ?? '__anon__'
  if (hasRole(principal, 'admin')) can('manage', 'all')

  can('read', Project, {ownerId: uid})
  can('update', Project, {ownerId: uid})
  if (principal) {
    can('create', Project).stamp(p => {
      p.orgId = String(principal.tenant)
      p.ownerId = String(principal.id)
    })
  }
})
```

## 3. Gate features by plan

Define your plan features and require them where they're used. A tenant whose
plan doesn't include a feature simply can't reach it:

```ts
import {defineFeatures, requireFeature} from '@getcronit/pylon-db'

const FEATURES = defineFeatures(['core', 'analytics'] as const)

export const Query = {
  analyticsReport: () => {
    requireFeature(FEATURES.analytics)
    return buildReport()
  }
}
```

## 4. Bind it to the request

Bind an [identity](/docs/authentication/overview) once, then a bare `useDatabase()`
derives the principal, tenant, and features from it — and every query downstream
is scoped, authorized, and gated:

```ts title="pylon.config.ts"
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {sessionAuth} from './src/identity'

export default {
  plugins: [useIdentity(sessionAuth), useDatabase()]
}
```

## The payoff

With those four pieces in place, your resolvers stay clean and your guarantees are
structural:

```ts
new Pylon({
  graphql: {
    Query: {
      // automatically: this org only, rows this user may read
      projects: () => Project.objects.all()
    },
    Mutation: {
      // automatically: orgId + ownerId stamped from the principal
      createProject: (name: string) => Project.objects.create({name})
    }
  }
})
```

A new query against `Project` is tenant-scoped and policy-checked the moment it's
written — there is no path that forgets the `WHERE` clause, because the rules
live with the data, not in each resolver. That's the difference between
"we try to remember to scope by org" and "it cannot leak."
