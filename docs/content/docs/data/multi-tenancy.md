---
title: Multi-Tenancy
nav: Multi-Tenancy
description: Declare a tenant column once and the ORM auto-scopes every read, write, and relation load to the current tenant.
section: Data — pylon-db
order: 8
---

Multi-tenancy in `pylon-db` is a property of the model, not a habit you have to
keep. You name the tenant column once; from then on the ORM **AND-s
`tenant = currentTenant()` into every read, write, and relation load, and
auto-stamps the tenant on create**. A query that forgets the tenant filter is not
possible — the scope is applied below your resolver, where it can't be skipped.

## Declare the tenant column

Set the tenant property on the app (covers every model in it) or on a single
model:

```ts title="src/apps/crm/index.ts"
import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon-db'

export class Contact extends models.Model {
  static objects = db.manager(Contact)
  id = models.ID()
  orgId = models.Text()   // the tenant column
  name = models.Text()
  email = models.Text()
}

// every model in this app is tenant-scoped on `orgId`
export const crm = new Pylon({name: 'crm', db: {models: [Contact], tenant: 'orgId'}})
```

To scope a single model instead of the whole app, set the tenant in its
`static config`: `static config = {tenant: 'orgId'} satisfies ModelConfig<Contact>`.

## How scoping applies

With `orgId` declared as the tenant, the ORM rewrites every operation against
`Contact`:

```ts
// resolver — no tenant filter in sight
contacts: () => Contact.objects.all()
// runs as: SELECT ... FROM contact WHERE org_id = $currentTenant

createContact: (name: string) => Contact.objects.create({name})
// org_id is stamped from the current tenant automatically
```

The scope follows relations too — loading `contact.notes` filters the notes to
the same tenant. **There is no path to a cross-tenant read through the normal
API.**

## Wiring

`useDatabase()` derives the tenant — and the principal for
[policies](/docs/data/policies) — from the bound `Principal` that `useIdentity`
sets. With identity in place, the minimal wiring is two plugins:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {sessionAuth} from './src/identity'

export default {
  plugins: [
    useIdentity(sessionAuth), // resolves the Principal (incl. its tenant)
    useDatabase()             // reads tenant + principal off the Principal
  ]
} satisfies PylonConfig
```

If your tenant lives somewhere other than the bound `Principal`, point
`useDatabase` at it explicitly — the resolver receives the request context:

```ts
useDatabase({
  tenant: c => c.get('session')?.orgId
})
```

`currentTenant()` reads the active tenant anywhere inside a request.

:::warning
A tenant-scoped read with **no bound tenant** throws — an unauthenticated or
misconfigured request can't silently fall through to every tenant's rows. Provide
a tenant, or opt out explicitly below.
:::

## Crossing tenants deliberately

Admin tooling, cross-tenant reports, and background reconciliation need to step
outside the scope. Two escape hatches make that explicit:

```ts
import {runAsSystem} from '@getcronit/pylon-db'

// one query, no tenant filter
const allContacts = await Contact.objects.unscoped().all()

// a whole block with full access (also bypasses policies)
await runAsSystem(async () => {
  for (const org of await Org.objects.all()) {
    await reindex(org)
  }
})
```

Both are deliberate, greppable, and out of the request path — the default stays
safe.

Tenant scoping composes with [authorization policies](/docs/data/policies): the
tenant filter narrows rows to the org, and the policy narrows them to what the
principal may see within it.
