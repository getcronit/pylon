---
title: Runtimes
nav: Runtimes
description: Run Pylon on Node.js, Bun, Deno, or Cloudflare Workers — the app owns serving through one universal handler.
section: Production
order: 0
---

A Pylon app runs unchanged on **Node.js, Bun, Deno, and Cloudflare Workers**. The
framework itself never opens a socket — **the app owns serving**. Because the
`Pylon` class extends Hono, `app.fetch` is a universal `(Request) => Response`
handler that every modern runtime knows how to call. You pick the runtime by adding
one serving plugin.

## The serving plugin

Serving is a plugin in `pylon.config.ts` with `strategy: 'last'` — it runs after
every other plugin has registered its routes, so the server starts listening only
once the app is fully assembled. On Node.js, hand `app.fetch` to `serve` from
`@hono/node-server`:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {serve} from '@hono/node-server'

export default {
  plugins: [
    {
      name: 'serve',
      strategy: 'last',
      setup: app => {
        serve({fetch: app.fetch, port: Number(process.env.PORT) || 3000})
      }
    }
  ]
} satisfies PylonConfig
```

The plugin receives the fully composed `app`. Everything else — runtime, port,
graceful shutdown — is yours to control.

## Bun

Bun serves `app.fetch` natively. Use `Bun.serve` from a serving plugin:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'

export default {
  plugins: [
    {
      name: 'serve',
      strategy: 'last',
      setup: app => {
        Bun.serve({fetch: app.fetch, port: Number(process.env.PORT) || 3000})
      }
    }
  ]
} satisfies PylonConfig
```

## Deno

Deno's built-in `Deno.serve` takes the same handler:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'

export default {
  plugins: [
    {
      name: 'serve',
      strategy: 'last',
      setup: app => {
        Deno.serve({port: Number(Deno.env.get('PORT')) || 3000}, app.fetch)
      }
    }
  ]
} satisfies PylonConfig
```

## Cloudflare Workers

Workers don't call a serving function — the platform invokes `fetch` on the module
export. Enable the `nodejs_compat` flag and deploy with `wrangler`:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'

const app = new Pylon({graphql: {/* ... */}})

export default app // Workers calls app.fetch(request, env, ctx)
```

```toml title="wrangler.toml"
name = "my-pylon-app"
main = ".pylon/server.mjs"
compatibility_flags = ["nodejs_compat"]
```

:::note
On Workers you export the app directly instead of adding a serving plugin — the
runtime owns the request loop. On Node, Bun, and Deno, the `strategy: 'last'`
plugin owns it. Same `app.fetch`, two entry conventions.
:::

## A runtime-portable config

Select the serving strategy from an environment variable and the same codebase
ships everywhere:

```ts title="pylon.config.ts"
import type {PylonConfig, Plugin} from '@getcronit/pylon'
import {serve} from '@hono/node-server'

const port = Number(process.env.PORT) || 3000

const nodeServe: Plugin = {
  name: 'serve',
  strategy: 'last',
  setup: app => serve({fetch: app.fetch, port})
}

const bunServe: Plugin = {
  name: 'serve',
  strategy: 'last',
  setup: app => Bun.serve({fetch: app.fetch, port})
}

export default {
  plugins: [process.versions.bun ? bunServe : nodeServe]
} satisfies PylonConfig
```

:::tip
`strategy: 'last'` exists precisely so serving binds the socket after the GraphQL
handler and all route plugins are mounted. Never start a server earlier in the
plugin list — you'll race the route registration.
:::

Once you've chosen a runtime, see [deployment](/docs/production/deployment) for
building and shipping the app.
