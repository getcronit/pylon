---
title: Configuration
description: The pylon.config.ts file — options and plugins.
section: Reference
order: 1
---

Project configuration lives in `pylon.config.ts`. Export a config object with
`satisfies PylonConfig`, or use `defineConfig` for async configuration.

```ts
import {type PylonConfig} from '@getcronit/pylon'

export default {
  graphiql: true,
  landingPage: true,
  plugins: []
} satisfies PylonConfig
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `graphiql` | `boolean` | `true` | Serve the GraphiQL playground at `/graphql` |
| `landingPage` | `boolean` | `true` | Serve Pylon's landing page at `/` |
| `plugins` | `Plugin[]` | `[]` | Pylon and Envelop plugins |

## Async configuration

Use `defineConfig` when configuration depends on async work or the environment:

```ts
import {defineConfig} from '@getcronit/pylon'

export default defineConfig(async () => ({
  graphiql: process.env.NODE_ENV !== 'production'
}))
```

## Plugins

Plugins extend the runtime. They come from their own packages now that the core
is lean: [`usePages`](/docs/frontend/use-pages) from `@getcronit/pylon-pages/plugin`,
[`useDatabase`](/docs/data/policies) from `@getcronit/pylon-db`,
[`useIdentity`](/docs/authentication/overview) from `@getcronit/pylon-auth`, and
[`useQueues`](/docs/queues/overview) from `@getcronit/pylon-queues`. Envelop
plugins are supported too.

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon-pages/plugin'
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {useQueues} from '@getcronit/pylon-queues'
import {headerAuth} from './src/identity'

export default {
  plugins: [
    // identity first; useDatabase derives tenant/principal from it
    useIdentity(headerAuth),
    useDatabase(),
    useQueues({connection: process.env.REDIS_URL}),
    usePages()
  ]
} satisfies PylonConfig
```

Order matters: plugins run in declaration order, and a `'last'`-strategy plugin
(like your [serving plugin](/docs/deployment/runtimes)) runs in the final boot
pass — after every route is mounted. A plugin can contribute Yoga/Envelop hooks,
Hono `middleware`, and a `setup` step that runs as the app boots.
