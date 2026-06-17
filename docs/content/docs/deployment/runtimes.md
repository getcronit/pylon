---
title: Deployment & Runtimes
description: Run Pylon on Node.js, Bun, Deno, or Cloudflare Workers — and ship it with Docker.
section: Production
order: 2
nav: Deployment
---

A Pylon app is a [Hono](https://hono.dev) app, so it runs anywhere Hono runs. Your
entry is the same everywhere — `export default new Pylon(...)`. **Serving is your
app's job**, added as a plugin in `pylon.config.ts`; only that plugin changes per
runtime. The framework's build only _boots_ the app.

## The entry (every runtime)

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    /* ... */
  }
})
```

## Build

`pylon build` compiles your project into `.pylon/`. Run it in CI or your image
build:

```bash
pylon build
```

## A serving plugin

Serving lives in a `'last'`-strategy plugin so it starts listening only after
every route (including [usePages](/docs/frontend/use-pages)' catch-all) is
mounted. On Node:

```ts title="pylon.config.ts"
import {type Plugin, type PylonConfig} from '@getcronit/pylon'
import {serve} from '@hono/node-server'

const serveLast = (): Plugin => ({
  name: 'serve',
  strategy: 'last',
  setup: app =>
    serve({fetch: app.fetch, port: Number(process.env.PORT) || 3000}, info =>
      console.log(`Running on ${info.port}`)
    )
})

export default {plugins: [serveLast()]} satisfies PylonConfig
```

```bash
node --enable-source-maps .pylon/index.js
```

For **Bun** and **Deno**, the plugin is the same shape — swap the server call for
`Bun.serve({fetch: app.fetch, port})` or `Deno.serve({port}, app.fetch)`:

```bash
bun run .pylon/index.js     # Bun
deno run -A .pylon/index.js # Deno
```

## Cloudflare Workers

Point `wrangler.toml` at the build output and deploy:

```toml title="wrangler.toml"
main = ".pylon/index.js"
compatibility_date = "2024-09-03"
compatibility_flags = ["nodejs_compat_v2"]
```

```bash
pylon build && wrangler deploy
```

:::warning
On Workers there is no filesystem at request time. If your resolvers read local
files, bundle that content at build time instead.
:::

## Docker

New projects include a `Dockerfile` for Node and Bun. The image runs `pylon build`
and serves `.pylon/index.js`:

```bash
docker build -t my-pylon .
docker run -p 3000:3000 my-pylon
```

## Configuration

Toggle the playground and landing page per environment in `pylon.config.ts`:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'

export default {
  graphiql: process.env.NODE_ENV !== 'production',
  landingPage: false,
  plugins: [
    /* serveLast(), usePages(), useDatabase(), ... */
  ]
} satisfies PylonConfig
```
