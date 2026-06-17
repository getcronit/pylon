---
title: Getting Started
description: Create your first Pylon project and serve a type-driven GraphQL API in under a minute.
section: Introduction
order: 3
---

This guide takes you from an empty folder to a running, type-driven GraphQL API in
about a minute.

## Create a project

```bash
npm create pylon@latest my-pylon
cd my-pylon
npm install
```

The scaffolder asks for a runtime (Node, Bun, Deno, or Cloudflare Workers) and
whether to include the [usePages](/docs/frontend/overview) frontend.

## Write your API

Everything starts in `src/index.ts`. Export a `graphql` object — Pylon reads the
TypeScript types of your resolvers and builds the schema for you.

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Query: {
      hello: () => 'Hello, world!'
    },
    Mutation: {}
  }
})
```

Your app is a `Pylon` instance. The `graphql` you pass it is what the compiler
reads to build your schema — there's nothing else to wire up.

## Run the dev server

```bash
npm run dev
```

Pylon watches your source, rebuilds the schema on every change, and serves an
interactive GraphiQL playground.

:::tip
Open `http://localhost:3000/graphql` to explore your API in GraphiQL — every
type and field you'll see is generated from the TypeScript above.
:::

## Add a typed field

Return a class and Pylon turns it into a GraphQL type — no schema edits, no
codegen step:

```ts title="src/index.ts" {1-5,10}
class User {
  id!: string
  name!: string
  email!: string | null
}

export default new Pylon({
  graphql: {
    Query: {
      user: (id: string): User | null => ({id, name: 'Ada', email: null})
    }
  }
})
```

Refresh the playground and `User` is already there, with `id`, `name`, and a
nullable `email`. That's the whole loop — change a type, the schema follows.

## Next steps

:::note[Where to go next]
- See how the [type-driven schema](/docs/core-concepts/type-driven-schema) maps your types to GraphQL.
- Add a database with [models](/docs/data/models) and [migrations](/docs/data/migrations).
- Build a UI with the [usePages](/docs/frontend/overview) frontend.
:::
