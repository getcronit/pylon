---
title: Getting Started
nav: Getting Started
description: Scaffold a Pylon project, write your first resolver, and get a typed GraphQL API with a playground in a couple of minutes.
section: Introduction
order: 3
---

This page takes you from nothing to a running, typed GraphQL API. It takes about
two minutes.

## Scaffold a project

```bash title="Terminal"
npm create pylon@latest
```

The scaffolder asks for a project directory, a runtime (Node.js, Bun, Deno, or
Cloudflare Workers), and optional features like the [usePages](/docs/frontend/overview)
frontend. When it finishes:

```bash title="Terminal"
cd my-app
npm install
```

## Your first API

Open `src/index.ts`. A Pylon app is one default export — `new Pylon({graphql})` —
whose resolver functions *are* your API:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'

class User {
  id!: string
  name!: string
  email!: string | null
}

export default new Pylon({
  graphql: {
    Query: {
      user: (id: string): User => ({id, name: 'Ada', email: null})
    }
  }
})
```

That's the whole schema. Pylon reads the types — `User`, the `id: string`
argument, the nullable `email` — and derives the GraphQL schema from them. There's
no SDL to write and nothing to keep in sync.

## Run the dev server

```bash title="Terminal"
npm run dev
```

`pylon dev` introspects your types, builds the server, and starts it with live
reload. Open the GraphQL playground it prints (by default
[http://localhost:3000/graphql](http://localhost:3000/graphql)) and run:

```graphql title="Playground"
query {
  user(id: "1") {
    id
    name
    email
  }
}
```

Edit a resolver, save, and the server rebuilds and reloads automatically.

## Add a database-backed model

Real apps need persistence. Pylon's [ORM](/docs/data/overview) lets the same class
back a database table *and* a GraphQL type:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, text} from '@getcronit/pylon/db'

class User extends Model {
  static objects = manager(User)
  id = id()
  name = text({min: 2})
  email = text({unique: true, email: true, nullable: true})
}

export default new Pylon({
  db: {models: [User]},
  graphql: {
    Query: {
      users: (): Promise<User[]> => User.objects.all()
    },
    Mutation: {
      createUser: (name: string): Promise<User> => User.objects.create({name})
    }
  }
})
```

Wire the database connection in `pylon.config.ts` with the
[`useDatabase`](/docs/reference/config) plugin, then create the tables:

```bash title="Terminal"
pylon db push        # sync your models to the database (great for dev)
```

`User.objects` is a fully typed query manager — `.filter()`, `.paginate()`,
`.create()`, and more. See [Querying](/docs/data/queries).

## Build for production

```bash title="Terminal"
pylon build          # → ./.pylon (server entry, schema, generated client)
npm start            # run the built app
```

For real migrations, deployment targets, and CI gating, see
[Migrations](/docs/data/migrations) and [Deployment](/docs/production/deployment).

## Where to go next

- [Type-Driven Schema](/docs/core-concepts/type-driven-schema) — how your types become the API.
- [Data](/docs/data/overview) — models, relations, and queries.
- [Frontend](/docs/frontend/overview) — add server-rendered React pages in the same project.
- [Build an App](/docs/guides/build-an-app) — an end-to-end tutorial.
