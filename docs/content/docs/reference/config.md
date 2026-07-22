---
title: Configuration
description: The pylon.config.ts file — options, the core plugins, and the Plugin contract that orders them.
section: Reference
order: 1
---

Project configuration lives in `pylon.config.ts`. It is separate from your app
(`src/index.ts`) on purpose: the build loads the config to run plugin `build`
hooks and to wire the runtime, while the app stays a pure declaration of your
schema and routes. Export an object with `satisfies PylonConfig`, or wrap an async
factory in `defineConfig`.

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'

export default {
  graphiql: true,
  landingPage: true,
  plugins: []
} satisfies PylonConfig
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `plugins` | `Plugin[]` | `[]` | Pylon plugins and Envelop plugins |
| `graphiql` | `boolean` | `true` | Serve the GraphiQL explorer at `/graphql` |
| `landingPage` | `boolean` | `true` | Serve Pylon's landing page at `/` |

## Async configuration

Use `defineConfig` when configuration depends on async work or the environment at
load time:

```ts title="pylon.config.ts"
import {defineConfig} from '@getcronit/pylon'

export default defineConfig(async () => ({
  graphiql: process.env.NODE_ENV === 'development'
}))
```

## Core plugins

The framework's batteries are plugins, each from its own package. Add the ones you
use to `plugins`.

### useDatabase

From `@getcronit/pylon-db`. Connects the ORM and binds the per-request database
context. A **bare** `useDatabase()` derives the tenant and principal from the bound
[identity](/docs/authentication/overview) automatically.

```ts
useDatabase(opts?)
```

| Option | Type | Description |
| --- | --- | --- |
| `connectionString` | `string` | Database URL (defaults to `DATABASE_URL`) |
| `tenant` | `string \| (c) => string` | Override the per-request tenant (default: from the `Principal`) |
| `principal` | `(c) => Principal` | Override the principal source (default: from `useIdentity`) |
| `features` | `string[] \| (c) => string[]` | Active feature set for the request |
| `validationErrors` | `boolean` | Surface model validation failures as GraphQL errors |
| `transactionPerRequest` | `boolean` | Wrap each request in a single database transaction |
| `nodeId` | `number \| 'lease'` | Snowflake node id for `id({snowflake:true})` PKs; `'lease'` claims a unique slot from the DB (multi-instance safe). Default `0` |

The global-id **namespace** is not a `useDatabase` option — it's part of the
global-id feature, set on the top-level `node` option:
`new Pylon({ node: {namespace: 'acme'} })` → `gid://acme/…` (default `pylon`).
See [IDs & Global IDs](/docs/data/ids).

See [Multi-tenancy & Features](/docs/data/multi-tenancy) and
[IDs & Global IDs](/docs/data/ids).

### useIdentity

From `@getcronit/pylon-auth`. Runs an identity provider once per request and binds
the resulting `Principal`. Place it **before** `useDatabase` so the database can
derive the tenant from it.

```ts
useIdentity(provider)
```

See [Authentication](/docs/authentication/overview).

### useQueues

From `@getcronit/pylon-queues`. Enables typed background jobs and the transactional
outbox.

```ts
useQueues(opts?)
```

| Option | Type | Description |
| --- | --- | --- |
| `connection` | `string` | Redis URL for the queue backend |
| `outbox` | `boolean` | Enable enqueue-iff-commit via a transactional outbox |
| `worker` | `'in-process' \| false` | Run workers inside the app (dev) or rely on `pylon worker` (prod) |

See [Background Jobs](/docs/queues/overview).

### usePages

From `@getcronit/pylon-pages/plugin`. Builds the typed client from your merged
schema and server-renders `pages/**/page.tsx`.

```ts
usePages()
```

See the [Frontend overview](/docs/frontend/overview).

### useSentry

From `@getcronit/pylon`. Wires Sentry error and performance monitoring into the
runtime.

```ts
useSentry(opts?)
```

See [Deployment](/docs/production/deployment).

### The serve plugin

Serving is owned by the app, not the framework. Start the HTTP server from a
plugin whose `strategy` is `'last'`, so it begins listening only after every route
and `'last'`-phase plugin has registered. On Node.js, use `serve` from
`@hono/node-server`:

```ts
import {serve} from '@hono/node-server'

{
  name: 'serve',
  strategy: 'last',
  setup: app => serve({fetch: app.fetch, port: Number(process.env.PORT) || 3000})
}
```

See [Runtimes](/docs/production/runtimes) for the Bun, Deno, and Cloudflare
Workers equivalents.

## The Plugin contract

Every plugin is an object with this shape:

```ts
type Plugin = {
  name?: string                          // identity, for ordering and error attribution
  strategy?: 'first' | 'last'            // phase relative to the GraphQL mount
  dependsOn?: string[]                   // plugin names this one must load after
  middleware?: MiddlewareHandler         // Hono middleware to install
  setup?: (app: Pylon) => void | Promise<void> // runtime wiring (serve, routes)
  build?: (args) => Promise<unknown>     // build-time hook (e.g. codegen)
}
```

**Ordering** happens in two stages:

- **`strategy` is the coarse phase** relative to the GraphQL handler mount.
  `'first'` plugins run before it (identity, database, middleware); `'last'`
  plugins run after it (catch-all routes, the serve plugin). Ordering serve last
  is what makes boot deterministic — by the time it calls `serve`, the GraphQL
  handler and every route are mounted.
- **`dependsOn` topologically sorts within a phase.** It pins a stable order when
  one plugin must initialize after another (the framework's own plugins use this —
  database depends on identity, page routes depend on the database). A cycle in
  `dependsOn` throws at boot.

A `build` hook runs at build time — `usePages`, for instance, generates the typed
client there. Each plugin's `setup` is wrapped so a failure is attributed to its
`name`.

## A complete pylon.config.ts

```ts title="pylon.config.ts"
import {serve} from '@hono/node-server'
import type {PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {useQueues} from '@getcronit/pylon-queues'
import {usePages} from '@getcronit/pylon-pages/plugin'
import {useSentry} from '@getcronit/pylon'
import {headerAuth} from './src/identity'

export default {
  graphiql: process.env.NODE_ENV === 'development',
  plugins: [
    useSentry({dsn: process.env.SENTRY_DSN}),
    useIdentity(headerAuth),          // binds the Principal first
    useDatabase(),                    // derives tenant + principal from it
    useQueues({
      connection: process.env.REDIS_URL,
      outbox: true,
      worker: process.env.NODE_ENV === 'development' ? 'in-process' : false
    }),
    usePages(),
    {
      name: 'serve',
      strategy: 'last',
      setup: app => serve({fetch: app.fetch, port: Number(process.env.PORT) || 3000})
    }
  ]
} satisfies PylonConfig
```

The declaration order above is also the runtime order within the `'first'` phase:
identity binds the principal, the database derives the tenant from it, queues run
inside that database context, and pages mount last among the `'first'` plugins —
with the serve plugin running alone in the `'last'` phase. See
[The Pylon App](/docs/core-concepts/the-pylon-app).
