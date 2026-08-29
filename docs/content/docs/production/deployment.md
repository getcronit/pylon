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
| `.pylon/server.mjs` | The **web** entry — imports your app, mounts the GraphQL handler + plugins, and serves HTTP |
| `.pylon/worker.mjs` | The **worker** entry — same app, [consumes queues](/docs/queues/overview) + drains the outbox, no HTTP |
| `.pylon/src/` | Your transpiled source, so the original `src/` isn't shipped |
| `.pylon/schema.graphql` | The compiled GraphQL schema (SDL) |
| `.pylon/client/` | The typed query client, derived from the schema |

Two entries, same build: `server.mjs` serves, `worker.mjs` consumes. Run one process
each (a web app with no queues just never runs `worker.mjs`).

Run it with whichever runtime you targeted in
[runtimes](/docs/production/runtimes):

```bash
node .pylon/server.mjs        # Node.js — web
bun run .pylon/server.mjs     # Bun
wrangler deploy             # Cloudflare Workers
```

If you use queues, run the worker as a second process from the **same build**:

```bash
node .pylon/worker.mjs        # background worker (see Queues)
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
node .pylon/standalone/start.mjs          # web
node .pylon/standalone/start-worker.mjs   # worker (if you use queues)
```

These generated `start.mjs` / `start-worker.mjs` are stable entry points at the artifact
root — the standalone twins of `.pylon/server.mjs` / `.pylon/worker.mjs`. Each `chdir`s
into the app so your own cwd-relative reads (say, a `content/` folder) resolve, then runs
its entry. The framework itself anchors to the entry location, so `.pylon/**` (schema, SSR
chunks, static assets) resolves no matter the working directory.

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
`--standalone` traces **both** entries, so the artifact runs either — `node
.pylon/standalone/start.mjs` (web) or `node .pylon/standalone/start-worker.mjs` (worker).
Tracing the worker costs nothing when the app has no queues. See [Run the worker alongside
the app](#run-the-worker-alongside-the-app).
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

:::note
A [`--standalone`](#standalone-build) serve image has **no CLI**, so it can't run these
commands itself — run them from a one-shot migrator step. See
[Migrating a standalone deploy](#migrating-a-standalone-deploy).
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

### Migrating a standalone deploy

The standalone artifact is serve-only: no `pylon` CLI, and `db deploy` needs one — it loads
your models (to verify the migrations still match) and applies the `migrations/` dir. So run
migrations from a **separate one-shot step** that *does* have the CLI, gated **before** the new
serve containers roll out. You don't need a second build — the `build` stage above already has
the source, deps, CLI and migrations. Give it a thin target:

```dockerfile title="Dockerfile (add a migrate target)"
# Reuse the build stage — it has the CLI + models + migrations/. One-shot: apply, then exit.
FROM build AS migrate
CMD ["node", "node_modules/@getcronit/pylon/dist/cli/index.js", "db", "deploy"]
```

Run the migrator once, then the serve image — the app waits for it to finish:

```yaml title="compose.yaml"
services:
  migrate:
    build: {context: ., target: migrate}
    environment: [DATABASE_URL]
    restart: 'no'                 # one-shot: apply migrations and exit
  app:
    build: {context: ., target: runner}
    environment: [DATABASE_URL, PORT]
    depends_on:
      migrate: {condition: service_completed_successfully}
    ports: ['3000:3000']
```

On Kubernetes, run migrations as a **Job** (runs once to completion), ordered before the
Deployment update — not an `initContainer`, which would run once *per replica*. No CLI in
your pipeline image? Run `pylon db deploy` straight from CI (your checkout has the CLI +
migrations) before deploying — simplest when CI can reach the database.

:::warning
One runner, once per release — a Job or a CI step, **never per-replica and never at app boot**,
where concurrent instances race the migration ledger. `db deploy` is idempotent (ledger-tracked),
so a retried job is safe. For a **breaking** schema change, expand/contract: ship the additive
migration plus code that tolerates both shapes, then a later contract migration — so old and new
instances coexist during the rollout.
:::

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
    # Same build as the app, a different entry: consumes queues, binds no port.
    command: node .pylon/worker.mjs
    environment: [DATABASE_URL, REDIS_URL]
```

If the image was built with `--standalone`, use the launcher names instead:
`node .pylon/standalone/start.mjs` for the app and
`node .pylon/standalone/start-worker.mjs` for the worker.

:::warning
Apply migrations as a discrete release step before rolling out new app instances — see
[Migrating a standalone deploy](#migrating-a-standalone-deploy). Never migrate from inside
application boot, where concurrent instances would race.
:::

For error and performance monitoring once you're live, see
[observability](/docs/production/observability).
