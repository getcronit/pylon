---
title: Deployment
nav: Deployment
description: Build your app with pylon build, apply migrations, and ship the app and worker together.
section: Production
order: 1
---

`pylon build` compiles your whole project — resolvers, schema, generated client —
into `./.pylon`. The output is **unbundled**: it imports your dependencies at
runtime, so you ship `.pylon` together with a production `node_modules` (the
Dockerfile below copies both). Deploying is then a matter of running it with your
runtime's command, applying database migrations, and running the
[worker](/docs/queues/overview) process alongside the app.

## Build

```bash
pylon build
```

The build emits everything needed to run (alongside your `node_modules`):

| File | What it is |
|---|---|
| `.pylon/server.mjs` | The runnable entry — imports your app, mounts the GraphQL handler + plugins, and serves |
| `.pylon/src/` | Your transpiled source, so the original `src/` isn't shipped |
| `.pylon/schema.graphql` | The compiled GraphQL schema (SDL) |
| `.pylon/client/` | The typed query client, derived from the schema |

Run it with whichever runtime you targeted in
[runtimes](/docs/production/runtimes):

```bash
node .pylon/server.mjs        # Node.js
bun run .pylon/server.mjs     # Bun
wrangler deploy             # Cloudflare Workers
```

## Environment

Configuration comes from the environment — read it in `pylon.config.ts` and your
plugins. The common variables:

| Variable | Used by |
|---|---|
| `PORT` | The serving plugin |
| `DATABASE_URL` | [`useDatabase`](/docs/data/database) |
| `REDIS_URL` | [`useQueues`](/docs/queues/overview) |

```bash
PORT=8080 \
DATABASE_URL=postgres://… \
REDIS_URL=redis://… \
node .pylon/server.mjs
```

## Database migrations

Generate migrations in development, then **apply** them in production as a deploy
step — never auto-migrate on boot:

```bash
pylon db deploy    # apply all pending migrations (idempotent)
pylon db migrate   # generate + apply (development)
pylon db check     # verify schema is in sync — exits non-zero on drift
```

:::tip
Run `pylon db check` in CI as a gate. It exits non-zero when the models and the
migration history have drifted, so a missing migration fails the pipeline instead
of failing in production.
:::

## Dockerfile

A single image builds once and runs either the app or the worker by command:

```dockerfile title="Dockerfile"
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx pylon build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.pylon ./.pylon
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["node", ".pylon/server.mjs"]
```

## Run the worker alongside the app

If you use [queues](/docs/queues/overview), run a second container from the **same
image** with the worker command. The app enqueues; the worker consumes and drains
the outbox:

```yaml title="compose.yaml"
services:
  app:
    image: my-pylon-app
    command: node .pylon/server.mjs
    environment: [DATABASE_URL, REDIS_URL, PORT]
    ports: ['3000:3000']

  worker:
    image: my-pylon-app
    command: pylon worker
    environment: [DATABASE_URL, REDIS_URL]
```

:::warning
Apply migrations as a discrete release step — a job, an init container, or a manual
`pylon db deploy` — before rolling out new app instances. Don't migrate from inside
application boot, where concurrent instances would race.
:::

For error and performance monitoring once you're live, see
[observability](/docs/production/observability).
