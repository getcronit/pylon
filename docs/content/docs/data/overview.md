---
title: Overview
nav: Overview
description: Pylon's ORM — one TypeScript class drives the table, the migrations, and the GraphQL type your resolvers return.
section: Data — pylon-db
order: 0
---

`@getcronit/pylon/db` is Pylon's ORM. You define a model once, as a TypeScript
class, and that single definition drives three things at once: the database
table, the migrations that create and evolve it, and the GraphQL type your
resolvers return. **There is no separate schema file to keep in sync** — the
class is the schema.

## One class, three jobs

A model is a class that extends `Model` and exposes a `static objects` manager;
you register it on a [`Pylon`](/docs/apps/overview) via the `db.models`
constructor option. Each field is declared by calling a builder, whose return
type is the field's value type — so your instances are fully typed.

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, text, boolean} from '@getcronit/pylon/db'

class User extends Model {
  static objects = manager(User)

  id = id()
  email = text({unique: true})
  name = text()
  isActive = boolean({default: true})
}

export default new Pylon({db: {models: [User]}})
```

That one class becomes a table and a GraphQL type:

:::generates
```ts title="You write"
class User extends Model {
  id = id()
  email = text({unique: true})
  name = text()
  isActive = boolean({default: true})
}

export default new Pylon({db: {models: [User]}})
```

```graphql title="Pylon generates"
type User {
  id: Int!
  email: String!
  name: String!
  isActive: Boolean!
}
```
:::

## Return models from resolvers

The manager queries rows; the rows are model instances; the instances are the
GraphQL type. Return one from a resolver and the schema lines up automatically:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {User} from './models'

export default new Pylon({
  db: {models: [User]},
  graphql: {
    Query: {
      users: () => User.objects.orderBy('name').all(),
      user: (id: number) => User.objects.get({id})
    }
  }
})
```

The mental model is one line: **a model class is both a table and a GraphQL
type, and the manager is how you move rows between them.**

## Wire the connection

`useDatabase()` is the plugin that connects to Postgres and binds the
per-request context — the tenant, the principal, and the transaction. Add it to
`pylon.config.ts` and every model is live:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon/db/plugin'

export default {
  plugins: [useDatabase()]
} satisfies PylonConfig
```

It defaults the connection string to `DATABASE_URL`. See
[Multi-Tenancy](/docs/data/multi-tenancy) for how it derives the tenant and
principal from your identity provider.

## The rest of this section

- [Models & Fields](/docs/data/models) — every field builder, column option, and
  `static config` setting, including composite indexes and full-text search.
- [Relations](/docs/data/relations) — foreign keys, one-to-many, and
  many-to-many, with batched, N+1-free loading.
- [Querying](/docs/data/queries) — the `Manager` / `QuerySet` API: filters,
  ordering, Relay pagination, search, and writes.
- [Validation](/docs/data/validation) — field rules that run before every write
  and surface as structured client errors.
- [Lifecycle Signals](/docs/data/signals) — Django-style hooks that fire inside
  the write transaction.
- [Migrations](/docs/data/migrations) — `db push` for dev, versioned migrations
  with a ledger for production.
- [Authorization Policies](/docs/data/policies) — row-level access rules that
  apply to every read, relation load, and write.
- [Multi-Tenancy](/docs/data/multi-tenancy) — a tenant column that the ORM
  auto-scopes into every query.
