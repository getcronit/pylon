---
title: The Pylon App
nav: The Pylon App
description: One default export defines your whole app — a Pylon instance that is also a Hono server.
section: Core Concepts
order: 2
---

A Pylon app is a single value you export from `src/index.ts`. `Pylon` is a class
that **extends Hono**, so an app is at once your GraphQL schema, your HTTP routes,
and your composition primitive. The entry contract is one line: a default export of
a `Pylon` instance.

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

The compiler reads the type of this default export's `.graphql` property to derive
the schema. There is no `export const graphql` and no `.resolvers()` call — the
single default export is the whole contract.

## Constructor options

```ts
new Pylon({graphql, gate?, basePath?})
```

- **`graphql`** — your `{Query?, Mutation?, Subscription?}` resolvers.
- **`gate`** — an optional `() => void | Promise<void>` that runs before
  resolvers and throws to deny access. See [Policies](/docs/data/policies).
- **`basePath`** — an optional route prefix (e.g. `'/vault'`) applied to this
  app's HTTP routes when composed. The GraphQL schema always merges to the root
  `/graphql`; `basePath` prefixes the Hono routes only.

## Composition

An app is built from smaller apps. `compose` merges every child's `graphql` into
**one schema served at one `/graphql`**, and mounts each child's routes at its
`basePath`:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {blog} from './apps/blog'
import {vault} from './apps/vault' // new Pylon({graphql, gate, basePath: '/vault'})

export default new Pylon().compose(blog, vault)
```

Each composed app keeps its own `gate` and `basePath`, so authorization and routing
stay local to the feature that owns them. This is the foundation of the
[apps](/docs/apps/overview) system.

## It's also a Hono app

Because `Pylon` extends Hono, every Hono method is available on the instance —
add plain HTTP routes alongside your GraphQL schema:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'

const app = new Pylon({
  graphql: {Query: {ping: (): string => 'pong'}}
})

app.get('/health', c => c.text('ok'))
app.use('/admin/*', async (c, next) => {
  // route middleware
  await next()
})

export default app
```

## Serving

The app owns serving. You start the HTTP server from `pylon.config.ts` with a
plugin whose `strategy` is `'last'`, so it begins listening **after** every route
and `'last'`-phase plugin has registered:

```ts title="pylon.config.ts"
import {serve} from '@hono/node-server'
import type {PylonConfig} from '@getcronit/pylon'

export default {
  graphiql: true,
  plugins: [
    {
      name: 'serve',
      strategy: 'last',
      setup: app => {
        serve({fetch: app.fetch, port: 3000})
      }
    }
  ]
} satisfies PylonConfig
```

Ordering the serve plugin last is what makes boot deterministic — by the time it
calls `serve`, the GraphQL handler and every catch-all route are already mounted.

## `PylonConfig`

The config object accepts:

- **`landingPage`** — show the default landing page at `/`.
- **`graphiql`** — enable the GraphiQL explorer.
- **`plugins`** — an array of [plugins](#plugins).

For static config, `satisfies PylonConfig` is enough. When you need to read the
environment at load time, wrap an async factory in `defineConfig`:

```ts title="pylon.config.ts"
import {defineConfig} from '@getcronit/pylon'

export default defineConfig(async () => ({
  graphiql: process.env.NODE_ENV === 'development'
}))
```

## Plugins

A plugin is a small object that hooks into build and runtime. The shape:

```ts
type Plugin = {
  name?: string                  // identity, for ordering and error attribution
  strategy?: 'first' | 'last'    // before or after the GraphQL handler mount
  dependsOn?: string[]           // other plugin names this one must load after
  middleware?: MiddlewareHandler // Hono middleware to install
  setup?: (app) => void | Promise<void> // runtime wiring (e.g. serve, routes)
  build?: (args) => Promise<...> // build-time hook (e.g. codegen)
}
```

`strategy` is the coarse phase relative to the GraphQL handler: `'first'` runs
before it, `'last'` runs after (the serve plugin, catch-all routes). `dependsOn`
gives a stable topological order within a phase; cycles throw. The framework's own
batteries — `useDatabase`, `useIdentity`, `usePages` — are plugins built on this
contract.
