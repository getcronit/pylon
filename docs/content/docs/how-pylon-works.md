---
title: How Pylon Works
nav: How It Works
description: The compiler reads your types to derive the schema, the database, and the client — a build phase and a run phase, one source of truth.
section: Introduction
order: 2
---

Pylon has one trick, and everything else follows from it: **a compiler that reads
the types of your code and derives the rest of the stack from them.** Understanding
that compiler — and the two phases it runs in — is the whole mental model.

## Your types are the source of truth

You write plain TypeScript. A class is a data shape; a function is a resolver. You
never write SDL, never write a `.prisma` file, never run a client codegen step by
hand. At build time, Pylon walks the *types* of your default-exported app and
projects them into concrete artifacts.

:::generates
```ts title="You write — src/index.ts"
import {Pylon} from '@getcronit/pylon'

class Post {
  id!: string
  title!: string
  published!: boolean
}

export default new Pylon({
  graphql: {
    Query: {
      posts: (): Post[] => Post.objects.all()
    }
  }
})
```
```graphql title="Pylon derives — schema.graphql"
type Post {
  id: String!
  title: String!
  published: Boolean!
}

type Query {
  posts: [Post!]!
}
```
:::

Nullability is significant: a return type of `Post | null` becomes a nullable
field, `Post[]` becomes `[Post!]!`. The compiler reads it exactly as TypeScript
sees it.

## The entry contract

Every Pylon app has one entry file with one default export:

```ts title="src/index.ts"
export default new Pylon({graphql, gate?, basePath?})
```

The compiler reads the **`.graphql` property of that default export** to build the
schema. At runtime, the same object supplies the resolver functions. One object,
read two ways — statically by the compiler, dynamically by the server.

Apps compose. An "app" is just a smaller `Pylon`, and a root app stitches them
together:

```ts title="src/index.ts"
export default new Pylon().compose(blogApp, shopApp)
```

`compose` merges every app's `graphql` into **one schema at one `/graphql`** and
mounts each app's routes. See [The Pylon App](/docs/core-concepts/the-pylon-app)
and [Apps](/docs/apps/overview).

## Two phases: build and run

Pylon does its work in two clearly separated phases.

**Build** is mostly static. The compiler uses the TypeScript type-checker to
introspect your entry, derives the GraphQL schema, validates it, emits the runtime
glue — an unbundled server entry (`.pylon/server.mjs`) that imports your app
alongside the derived schema — and generates a typed query client from the schema
into `.pylon/client`. When the ORM is present, its model definitions contribute a
richer intermediate representation (precise column types, relations, hidden
fields) that's merged into the schema. The build never touches your database or
network — it's pure type-introspection plus runtime-agnostic model loading.

**Run** is your app serving traffic. The generated server entry boots the GraphQL
handler and your plugins. Notably, **Pylon does not serve for you** — your app
owns serving through a small `strategy: 'last'` plugin in `pylon.config.ts` that
calls the host runtime's `serve()`. That keeps Pylon portable across Node.js,
Bun, Deno, and Cloudflare Workers, and means serving starts only after every
route is registered.

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {serve} from '@hono/node-server'

export default {
  plugins: [
    {
      name: 'serve',
      strategy: 'last',
      setup: app => serve({fetch: app.fetch, port: Number(process.env.PORT) || 3000})
    }
  ]
} satisfies PylonConfig
```

## The frontend rides the same compiler

The build phase also analyzes your [usePages](/docs/frontend/overview) frontend.
When a page reads `data.posts.map(p => p.title)`, the compiler sees exactly which
fields the page touches and generates the minimal GraphQL query for them — at
build time, type-checked against the same schema your resolvers produced. The
frontend literally cannot ask for a field the API doesn't have.

## Why the two-phase split matters

Because the schema, the database DDL, and the client are all projections of one
intermediate representation, a single change ripples through all of them and is
checked by the compiler before anything runs. Rename a field and the schema, the
migration diff, and the client types all move together — or the build fails and
tells you why.

That's the payoff of the whole design: [one model the compiler can verify](/docs/why-pylon),
end to end.

Next: [scaffold a project and ship your first API](/docs/getting-started).
