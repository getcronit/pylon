---
title: Introduction
nav: Introduction
description: Pylon turns plain TypeScript into a production GraphQL API, an ORM, queues, auth, and a React frontend — all derived from your types.
section: Introduction
order: 0
---

Most backends make you say the same thing many times. You describe your data in a
schema language, then again in your resolvers, then again in a database migration,
and a fourth time in the types your client uses. Every copy is a place for them to
drift — and they always do.

**Pylon collapses those copies into one.** You write plain TypeScript — functions
and classes — and a compiler reads their *types* to derive the rest: a real
GraphQL schema, the database tables behind it, and a typed client your frontend
reads from. Nothing is written twice, so nothing can fall out of sync.

:::generates
```ts title="You write"
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
```graphql title="Pylon generates"
type User {
  id: String!
  name: String!
  email: String
}

type Query {
  user(id: String!): User
}
```
:::

No SDL to maintain. No decorators describing types the compiler can already see.
No codegen step you have to remember to run. You write the function; Pylon derives
the API.

## One framework, not six libraries

A typical TypeScript backend is an assembly job: a GraphQL server here, an ORM
there, a queue library, an auth middleware, a client codegen tool, and a separate
frontend project to glue to all of it. Each one has its own model of your data,
and keeping those models agreeing is the work.

Pylon ships the whole stack from a single source of truth:

- **A type-driven GraphQL API** — your functions and classes become the schema.
- **A batteries-included ORM** — [`pylon-db`](/docs/data/overview): models, relations,
  migrations, validation, and row-level policies that never drift from your API.
- **Background jobs** — [typed queues, cron, and a transactional outbox](/docs/queues/overview),
  without bolting on a second framework.
- **Authentication & authorization** — [capability and resource authz](/docs/authentication/overview)
  that apply at the data layer, so they're impossible to forget.
- **A React frontend** — [`usePages`](/docs/frontend/overview): file-based routing where
  every page fetches exactly the data it renders, server-rendered and hydrated.
- **Composable apps** — bundle models, resolvers, and routes into [modular apps](/docs/apps/overview)
  and compose them into one deployment.

It runs on Node.js, Bun, Deno, and Cloudflare Workers.

## Why derived beats declared

The point isn't that Pylon writes less code. It's that the code it derives
*can't disagree with itself*. When the API, the database, and the client all come
from the same types, a change in one place is checked against every other place by
the compiler — before it ever runs.

That makes a Pylon codebase unusually safe to change, for two audiences at once:
the engineers refactoring it, and the AI agents increasingly writing alongside
them. A single model a compiler can verify is the soundest foundation either can
build on.

:::tip[New to Pylon?]
Jump straight to [Getting Started](/docs/getting-started) to scaffold a project
and ship your first typed API in a couple of minutes — or read
[Why Pylon](/docs/why-pylon) for the longer argument.
:::
