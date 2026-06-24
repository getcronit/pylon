---
title: Apps
nav: Apps
description: Bundle models, migrations, resolvers, and a gate into a feature — then compose features into one deployment.
section: Apps
order: 0
---

An **app** is a self-contained feature: its own GraphQL resolvers and routes, its
own authorization gate, and its own set of models. Technically, an app is a
smaller [`Pylon`](/docs/core-concepts/the-pylon-app) instance plus models tagged
with `models.app(name)`. The root `Pylon` **composes** apps into a single
deployment — one schema, one `/graphql`, one set of migrations ordered by
dependency. This is Django-style modular structure, brought to a fully typed
TypeScript stack: bundle a feature, then compose features.

## What an app is

An app folder owns three things:

- **Models** tagged with `models.app(name)`, so `pylon db` puts their migrations
  in one dependency-ordered group.
- **A `Pylon` instance** carrying the app's `graphql` resolvers, any HTTP routes,
  an optional `basePath`, and a `gate`.
- **Abilities / policies** scoping the app's rows (see
  [Policies](/docs/data/policies)).

```ts title="src/apps/blog/index.ts"
import {models, db, gate} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'
import {Pylon} from '@getcronit/pylon'

const blog = models.app('blog')

@blog.model()
export class Post extends blog.Model {
  static objects = db.manager(Post)
  id = blog.ID()
  title = blog.Text()
  body = blog.Text()
}

export const blogApp = new Pylon({
  graphql: {
    Query: {posts: () => Post.objects.orderBy('-id').all()},
    Mutation: {
      createPost: (title: string, body: string) =>
        Post.objects.create({title, body})
    }
  },
  gate: gate({authorize: p => hasRole(p, 'author')})
})
```

A second app looks the same — its own models, resolvers, and gate:

```ts title="src/apps/shop/index.ts"
import {models, db, gate} from '@getcronit/pylon-db'
import {hasRole} from '@getcronit/pylon-auth'
import {Pylon} from '@getcronit/pylon'

const shop = models.app('shop')

@shop.model()
export class Product extends shop.Model {
  static objects = db.manager(Product)
  id = shop.ID()
  name = shop.Text()
  price = shop.Numeric({precision: 10, scale: 2})
}

export const shopApp = new Pylon({
  graphql: {Query: {products: () => Product.objects.all()}},
  gate: gate({authorize: p => hasRole(p, 'shopper')}),
  basePath: '/shop'
})
```

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

Because each app's models are tagged with `models.app(name)`, `pylon db` derives
one migration group per app and orders the groups by their dependencies —
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

An app can be tenant-scoped and secure as a unit. `models.app(name, {tenant,
secure})` applies the tenant column and deny-by-default authorization to every
model in the app:

```ts
const crm = models.app('crm', {tenant: 'orgId', secure: true})
```

See [Multi-Tenancy](/docs/data/multi-tenancy) for the scoping model.

## When to reach for apps

Start with a single `Pylon`. Split into apps when a feature earns its own
boundary — its own models, its own gate, its own migration history that ships and
evolves on its own cadence. An app is the unit you can lift into another
deployment intact, because it carries everything it needs: data, API, and access
rules together.
