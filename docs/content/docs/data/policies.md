---
title: Authorization Policies
nav: Policies
description: Row-level access rules enforced inside the ORM — applied to every query, relation load, and write, impossible to forget.
section: Data — pylon-db
order: 7
---

Authorization in `pylon-db` is **row-level and enforced inside the ORM**. The
rules you declare apply to every query, every relation load, and every write of a
model — so access can't be bypassed by forgetting a `WHERE` clause in one
resolver. This is the **resource tier** of authz. The **capability tier**
(roles, permissions, who the principal is) lives in
[`@getcronit/pylon-auth`](/docs/authentication/overview); the two compose.

## Abilities — the high-level surface

`defineAbilities` receives the current `principal` and a `can` builder. You grant
actions on models, optionally scoped by a row condition that's AND-ed into every
read:

```ts title="src/abilities.ts"
import {defineAbilities} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'
import {Task} from './models'

defineAbilities((principal, can) => {
  // role-based: admins can do anything
  if (hasRole(principal, 'admin')) can('manage', 'all')

  // attribute-based: a row condition AND-ed into every read
  can('read', Task, {OR: [{ownerId: principal?.id}, {shared: true}]})
  can('update', Task, {ownerId: principal?.id})
  can('delete', Task, {ownerId: principal?.id})

  // stamp server-owned columns on create so clients can't spoof them
  if (principal) {
    can('create', Task).stamp(t => {
      t.orgId = String(principal.tenant)
      t.ownerId = String(principal.id)
    })
  }
})
```

- `can('manage', 'all')` grants every action on every model.
- `can('read' | 'update' | 'delete', Model, condition?)` grants the action,
  scoped by an optional `WhereInput` the row must match.
- `can('create', Model).stamp(fn)` grants create and mutates the new instance
  before insert — the place to stamp ownership or tenant from the principal.

## How it applies

Reads are filtered automatically, so a resolver stays clean — the rules apply
implicitly:

```ts
new Pylon({
  graphql: {
    Query: {
      // automatically scoped to rows the principal may read (+ tenant scope)
      tasks: () => Task.objects.all()
    }
  }
})
```

For writes, call `authorize(action, instance)` to enforce the rule on a specific
instance. It throws `ForbiddenError` (→ `403`) if the principal isn't allowed:

```ts
import {authorize} from '@getcronit/pylon-db'

const renameTask = async (id: number, title: string) => {
  const task = await Task.objects.get({id})
  authorize('update', task) // ForbiddenError if not owner (or admin)
  task.title = title
  await task.$save()
  return task
}
```

Check without throwing using `can` / `cannot`. `filter(action, Model)` returns
the policy scope as a `WhereInput` (or a boolean), which you can fold into a
manual query:

```ts
import {can, filter} from '@getcronit/pylon-db'

if (can('update', task)) { /* ... */ }

const scope = filter('read', Task) // WhereInput | boolean
```

The capability form of `authorize` takes a predicate over the principal, for a
check that isn't about a row:

```ts
import {authorize} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'

authorize(p => hasRole(p, 'billing')) // ForbiddenError on false
```

## Deny by default

By default, a model with no rule for an action **allows** it — abilities are
additive grants on top of an open base. Flip that for high-stakes models by
marking the model, or the whole app, `secure`. Then any action without a matching
rule is denied, so forgetting a rule fails closed:

```ts
const projects = models.app('projects', {tenant: 'orgId', secure: true})
// or on one model: @model({secure: true})
```

## The low-level seam: `db.definePolicy`

Abilities compile down to per-model row policies. For raw-ORM use you can author
those directly with `db.definePolicy`, returning a `WhereInput` scope, `true`, or
`false` per action:

```ts
import {db} from '@getcronit/pylon-db'

db.definePolicy(Note, {
  read:   ({principal}) => principal?.role === 'ADMIN' ? true : {ownerId: principal?.id},
  update: ({principal}) => ({ownerId: principal?.id}), // row that doesn't match → ForbiddenError
  delete: ({principal}) => ({ownerId: principal?.id}),
  create: ({principal}) => !!principal,                // boolean gate — no row yet
  onCreate: ({principal}, note) => { note.ownerId = principal.id } // stamp ownership
})
```

The policy context carries the bound `principal`, `tenant`, and enabled
`features`. `read` is AND-ed into selects, counts, paginates, and relation loads;
`update` / `delete` are AND-ed into the write's `WHERE`; `create` is a boolean
gate.

## Gating an app

Each [app](/docs/apps/overview) carries a capability `gate` — a check that runs
before its resolvers. The `gate({authorize, feature})` helper builds one from a
principal predicate and an optional feature flag, returning a `Gate` for the
`Pylon` constructor:

```ts
import {gate} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'

export const crm = new Pylon({
  graphql: {Query: {contacts: () => Contact.objects.orderBy('name').all()}},
  gate: gate({authorize: p => hasRole(p, 'crm'), feature: 'crm'})
})
```

`authorize` failing throws `ForbiddenError`; a disabled `feature` throws
`FeatureDisabledError`. Use `requireFeature('crm')` to gate inside a resolver,
and `defineFeatures` to declare the flag set.

## Bypassing

Trusted server code — background jobs, admin tooling, migrations — runs with full
access via `runAsSystem`, and skips tenant scoping with `.unscoped()`:

```ts
import {runAsSystem} from '@getcronit/pylon-db'

await runAsSystem(async () => {
  const everyTask = await Task.objects.unscoped().all()
})
```

## The CRM example

Putting it together — a secure, tenant-scoped app whose resolvers are gated and
whose rows are owner-scoped:

```ts title="src/apps/crm/index.ts"
import {authorize, db, defineAbilities, gate, models} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'
import {Pylon} from '@getcronit/pylon'

const crm_ = models.app('crm', {tenant: 'orgId', secure: true})

@crm_.model()
export class Contact extends crm_.Model {
  static objects = db.manager(Contact)
  id = crm_.ID()
  orgId = crm_.Text()
  ownerId = crm_.Text()
  shared = crm_.Boolean({default: false})
  name = crm_.Text()
}

defineAbilities((p, can) => {
  if (hasRole(p, 'admin')) can('manage', 'all')
  can('read', Contact, {OR: [{ownerId: p?.id}, {shared: true}]})
  if (p) {
    can('create', Contact).stamp(c => {
      c.orgId = String(p.tenant)
      c.ownerId = String(p.id)
    })
  }
})

export const crm = new Pylon({
  graphql: {Query: {contacts: () => Contact.objects.orderBy('name').all()}},
  gate: gate({authorize: p => hasRole(p, 'crm')})
})
```

`secure: true` means a `Contact` action with no `can(...)` is denied; the
`tenant: 'orgId'` scope filters every read to the current org; the `gate`
requires the `crm` capability before any resolver runs. See
[Multi-Tenancy](/docs/data/multi-tenancy) for the tenant layer and
[Apps](/docs/apps/overview) for composing the app into a deployment.

:::tip[Related guide]
[Role-Based Access Control](/docs/guides/role-based-access-control) walks through abilities, gates, and roles end to end.
:::
