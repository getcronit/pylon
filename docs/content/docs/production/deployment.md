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

## Standalone build

For a self-contained artifact — the app plus **only** the `node_modules` files it
actually uses — add `--standalone`:

```bash
pylon build --standalone
```

This traces the runtime file graph of `.pylon/server.mjs` and copies the closure
into `.pylon/standalone/`. The result runs with plain `node` and **no install** — drop
it into a `scratch`/distroless image and go. Same idea as Next.js `output: 'standalone'`,
and it works with any package manager (npm, pnpm, yarn, bun): the trace copies files,
not a lockfile.

```bash
node .pylon/standalone/start.mjs
```

The generated `start.mjs` is a stable entry point you can run from any directory — it
`chdir`s into the app so your own cwd-relative reads (say, a `content/` folder) resolve.
The framework itself anchors to the entry location, so `.pylon/**` (schema, SSR chunks,
static assets) resolves no matter the working directory.

Tracing — not bundling — is what makes this safe: `sharp`'s native binaries, the
content-hashed usePages SSR route chunks (imported at runtime), and the unbundled
transpiled app are all preserved as files, so nothing breaks at runtime.

### Data the app reads at runtime

The tracer follows imported **code**, not files your app opens with `fs` at runtime — a
`content/` folder of markdown, a `data/` dir, seed files. Declare those with `--include`
(repeatable) and they're copied into the artifact:

```bash
pylon build --standalone --include content --include data
```

The launcher `chdir`s into the app dir before starting, so a `content/` read resolves
exactly as it does in development.

:::note
`--standalone` traces the **app server**. If you also run the [worker](/docs/queues/overview),
deploy it from the regular build (`node .pylon/src/worker.js`) — see
[Run the worker alongside the app](#run-the-worker-alongside-the-app).
:::

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

With `--standalone`, the runner needs no package manager and no `node_modules` copy —
just the traced artifact. That makes a tiny, distroless image:

```dockerfile title="Dockerfile"
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Trace runs HERE, so the native binaries (sharp) match the runner's platform.
RUN npx pylon build --standalone

# Distroless: no shell, no package manager, runs as non-root.
FROM gcr.io/distroless/nodejs22-debian12:nonroot
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /app/.pylon/standalone ./
EXPOSE 3000
# The distroless nodejs ENTRYPOINT is `node`, so CMD passes only args.
CMD ["start.mjs"]
```

:::tip
Build the trace on the **same platform/libc as the runner** (here both are Debian
glibc) so the copied `sharp` binaries match. A `node:*-alpine` builder (musl) with a
Debian runner would ship the wrong native binary.
:::

Prefer to ship the app and worker from **one** image instead? Skip `--standalone` and copy
`.pylon` + a production `node_modules` (`RUN npx pylon build`, then
`COPY --from=build /app/.pylon ./.pylon` and `.../node_modules ./node_modules`) — the
[worker section](#run-the-worker-alongside-the-app) below runs both processes by command.

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
