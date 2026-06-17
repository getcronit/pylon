---
title: Apps
description: Compose modular feature units — each its own Pylon with models, resolvers, routes, and authz — into one service.
section: Apps
order: 0
nav: Composing apps
---

As a project grows, you'll want to group related models, resolvers, routes, and
authorization into self-contained units. In Pylon, **an app is just a `Pylon`
instance** — with its own `graphql`, its own routes, and its own models. The root
`Pylon` composes them into a single service with one merged schema.

## An app is a Pylon

Define a feature as a `Pylon` whose `graphql` is declared in its constructor, with
name-tagged, tenant-scoped models alongside it:

```ts title="apps/projects.ts"
import {Pylon} from '@getcronit/pylon'
import {db, models} from '@getcronit/pylon-db'

// Tenant-scoped (orgId) + deny-by-default authorization.
const projects = models.app('projects', {tenant: 'orgId', secure: true})

@projects.model() // → table "projects_task"
export class Task extends projects.Model {
  static objects = db.manager(Task)
  id = projects.ID()
  orgId = projects.Text()
  ownerId = projects.Text()
  title = projects.Text()
}

export const projectsApp = new Pylon({
  graphql: {
    Query: {
      tasks: (): Promise<Task[]> => Task.objects.all() // ability- + tenant-scoped automatically
    },
    Mutation: {
      createTask: (title: string): Promise<Task> => Task.objects.create({title})
    }
  }
})

// A Pylon extends Hono — add routes directly on the instance.
projectsApp.get('/projects/health', c => c.json({ok: true}))
```

## Compose at the root

The root imports each app and merges them with `compose`. The result is one
schema (the deep union of every app's `graphql`) and all their routes mounted
together:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {projectsApp} from './apps/projects'
import {billingApp} from './apps/billing'

export default new Pylon().compose(projectsApp, billingApp)
```

The compiler reads the composed `graphql` and type-introspects it into a single
merged schema — exactly as it does for a single app.

## Route prefixes

Give an app a `basePath` to namespace its routes (handy for per-app middleware or
gating a whole surface):

```ts
export const vaultApp = new Pylon({
  basePath: '/vault',
  graphql: {/* ... */}
})
```

GraphQL still merges to the root `/graphql`; the `basePath` only prefixes the
app's own Hono routes.

## Cross-app relations

An app can reference another app's models. A foreign key that points across apps
works like any other:

```ts title="apps/shop.ts"
import {db, models} from '@getcronit/pylon-db'
import {Task} from './projects'

const shop = models.app('shop')

@shop.model()
export class Purchase extends shop.Model {
  static objects = db.manager(Purchase)
  id = shop.ID()
  taskId = shop.ForeignKey(() => Task) // cross-app FK → projects_task
}
```

## Per-app migrations

Migrations are organized per app under `migrations/<app>/`. Pylon infers the
dependency order from cross-app foreign keys and applies them correctly:

```bash
pylon db diff -a projects   # generate a migration for the projects app
pylon db migrate            # apply all apps, in dependency order
```

## Authorization & tenancy per app

Because an app declares its tenant column and `secure` flag on `models.app(...)`,
tenant scoping and deny-by-default apply to all of its models. Pair that with
[abilities](/docs/data/policies) for row-level rules and
[identity](/docs/authentication/overview) for the principal — see
[Multi-tenancy & Features](/docs/data/multi-tenancy).
