---
title: Authorization (Abilities)
description: Row-level access rules that apply to every query, relation load, and write — impossible to forget.
section: Data — pylon-db
order: 5
nav: Authorization
---

Abilities enforce **row-level authorization at the data layer**. The rules you
declare apply to every query, every relation load, and every write of a model — so
access can't be bypassed by forgetting a `WHERE` clause in one resolver. This is
the **resource tier** of authz; the **capability tier** (roles/permissions) lives
in [authentication](/docs/authentication/overview).

## Defining abilities

`defineAbilities` receives the current `principal` and a `can` builder. You grant
actions on models, optionally scoped by a row condition:

```ts
import {defineAbilities} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'

defineAbilities((principal, can) => {
  const uid = principal?.id ?? '__anon__'

  // role-based: admins can do anything
  if (hasRole(principal, 'admin')) can('manage', 'all')

  // attribute-based: a row condition that's AND-ed into every read
  can('read', Task, {OR: [{ownerId: uid}, {shared: true}]})
  can('update', Task, {ownerId: uid})

  // stamp server-owned fields on create, so clients can't spoof them
  if (principal) {
    can('create', Task).stamp(t => {
      t.orgId = String(principal.tenant)
      t.ownerId = String(principal.id)
    })
  }
})
```

- `can('manage', 'all')` grants every action on every model.
- `can('read' | 'update' | 'delete', Model, condition)` grants the action, scoped
  by an optional `WhereInput` the row must match.
- `can('create', Model).stamp(fn)` grants create and mutates the new instance
  before insert — the place to stamp ownership or tenant from the principal.

## How it applies

Reads are filtered automatically. With the abilities above, a resolver stays
clean — the rules apply implicitly:

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

For writes, call `authorize` to enforce the rule on a specific instance — it
throws `ForbiddenError` (→ `403`) if the principal isn't allowed:

```ts
import {authorize} from '@getcronit/pylon-db'

renameTask: async (id: number, title: string) => {
  const task = await Task.objects.get({id})
  authorize('update', task) // ForbiddenError if not owner (or admin)
  task.title = title
  await task.$save()
  return task
}
```

You can also check without throwing using `can` / `cannot`:

```ts
import {can} from '@getcronit/pylon-db'
if (can('update', task)) {
  /* ... */
}
```

## The principal

The principal comes from the bound identity (see
[Authentication](/docs/authentication/overview)). Wire it once with `useIdentity`
+ `useDatabase`, and abilities have everything they need:

```ts title="pylon.config.ts"
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {headerAuth} from './src/identity'

export default {plugins: [useIdentity(headerAuth), useDatabase()]}
```

## Deny by default

By default a model with no rule for an action allows it (abilities are additive
grants on top of an open base). Flip that to deny-by-default by marking the model
— or the whole app — `secure`:

```ts
const projects = models.app('projects', {tenant: 'orgId', secure: true})
// now any action without a matching `can(...)` is denied
```

## Bypassing

Trusted server code — background jobs, admin tooling, migrations — can run with
full access using `runAsSystem`, and skip tenant scoping with `unscoped()`:

```ts
import {runAsSystem} from '@getcronit/pylon-db'

await runAsSystem(async () => {
  const everyTask = await Task.objects.unscoped().all()
  // ...
})
```
