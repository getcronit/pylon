---
title: Apps
nav: Apps
description: Bundle models, migrations, resolvers, and a gate into a feature — then compose features into one deployment.
section: Apps
order: 0
---

An **app** is a self-contained feature: its own GraphQL resolvers and routes, its
own authorization gate, and its own set of models. Technically, an app is a
smaller [`Pylon`](/docs/core-concepts/the-pylon-app) instance, named with `name`,
whose models are attached with `@app.model()`. The root `Pylon` **composes** apps
into a single deployment — one schema, one `/graphql`, one set of migrations
ordered by dependency. This is Django-style modular structure, brought to a fully
typed TypeScript stack: bundle a feature, then compose features.

## What an app is

An app folder owns three things:

- **A named `Pylon` instance** carrying the app's `graphql` resolvers, any HTTP
  routes, an optional `basePath`, and a `gate`. The `name` is the migration-group
  key.
- **Models** attached with `@app.model()` (and background jobs with
  `@app.queue()` — see [Background Jobs](/docs/background-jobs/overview)), so
  `pylon db` puts the app's migrations in one dependency-ordered group.
- **Abilities / policies** scoping the app's rows — co-located on each model with
  [`static abilities`](/docs/data/policies).

```ts title="src/apps/blog/index.ts"
import {Model, manager, id, text, gate} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'
import {Pylon} from '@getcronit/pylon'

export const blogApp = new Pylon({
  name: 'blog',
  graphql: {
    Query: {posts: () => Post.objects.orderBy('-id').all()},
    Mutation: {
      createPost: (title: string, body: string) =>
        Post.objects.create({title, body})
    }
  },
  gate: gate({authorize: p => hasRole(p, 'author')})
})

@blogApp.model()
export class Post extends Model {
  static objects = manager(Post)
  id = id()
  title = text()
  body = text()
}
```

A second app looks the same — its own name, models, resolvers, and gate:

```ts title="src/apps/shop/index.ts"
import {Model, manager, id, text, numeric, gate} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'
import {Pylon} from '@getcronit/pylon'

export const shopApp = new Pylon({
  name: 'shop',
  graphql: {Query: {products: () => Product.objects.all()}},
  gate: gate({authorize: p => hasRole(p, 'shopper')}),
  basePath: '/shop'
})

@shopApp.model()
export class Product extends Model {
  static objects = manager(Product)
  id = id()
  name = text()
  price = numeric({precision: 10, scale: 2})
}
```

:::note
The older `models.app(name)` string scoping still works — `const blog =
models.app('blog')` then `@blog.model()` — but naming the `Pylon` instance and
attaching models with `@app.model()` keeps the app, its models, and its
migrations under one object.
:::

## Compose them at the root

The root entry composes the apps. `compose` merges every app's `graphql` into
**one schema served at one `/graphql`**, mounts each app's routes at its
`basePath`, and keeps each app's `gate` local to the feature that owns it:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {blogApp} from './apps/blog'
import {shopApp} from './apps/shop'

export default new Pylon().compose(blogApp, shopApp)
```

That's the whole deployment: a `posts` and `createPost` from the blog, a
`products` from the shop, all on one endpoint, each guarded by its own gate. See
[The Pylon App](/docs/core-concepts/the-pylon-app) for the composition mechanics.

## Migrations follow the apps

Because each app's models are attached with `@app.model()`, `pylon db` derives
one migration group per app — keyed by the app's `name` — and orders the groups
by their dependencies —
inferred from cross-app foreign keys, plus any explicit `dependsOn`. Generate a
migration for a single app, or migrate everything in order:

```bash
pylon db diff --app blog add_post_table   # generate for the blog app
pylon db migrate                          # apply every app's migrations, ordered
pylon db status                           # per-app applied / pending
```

See [Migrations](/docs/data/migrations) for the full workflow.

## Cross-app relations

A model in one app can relate to a model in another. Declare the canonical side
of a many-to-many normally and mark the other side `{inverse: true}`, so each app
still synthesizes only its own tables — the inverse side reads and writes the
join table the canonical app owns:

```ts
// in the shop app — owns the join table
tags = manyToMany(() => Tag)

// in the blog app — borrows it
products = manyToMany(() => Product, {inverse: true})
```

## Tenancy per app

An app can be tenant-scoped and secure as a unit. The `models` config on the
`Pylon` constructor applies the tenant column and deny-by-default authorization
to every model in the app:

```ts
const crm = new Pylon({name: 'crm', models: {tenant: 'orgId', secure: true}})
```

See [Multi-Tenancy](/docs/data/multi-tenancy) for the scoping model.

## When to reach for apps

Start with a single `Pylon`. Split into apps when a feature earns its own
boundary — its own models, its own gate, its own migration history that ships and
evolves on its own cadence. An app is the unit you can lift into another
deployment intact, because it carries everything it needs: data, API, and access
rules together.
