---
title: CLI Reference
description: Every pylon command — dev, build, worker, pull, db, and project scaffolding.
section: Reference
order: 0
---

The Pylon CLI ships in `@getcronit/pylon-dev` and is invoked as `pylon`. It drives
the type-introspecting build, the dev loop, queue workers, remote-API gateways,
and database migrations. Commands that touch the database read `DATABASE_URL`.

## pylon dev

Start the development loop: type-introspect the schema, build the server and pages,
watch your source, and restart the app with a browser live-reload on every change.
Live-reload is served over SSE on `PORT + 1`.

```bash
pylon dev
pylon dev -c "node --enable-source-maps .pylon/index.js"
```

| Option | Default | Description |
| --- | --- | --- |
| `-c, --command <cmd>` | `bun run .pylon/index.js` | Command that runs the built app (varies by runtime; set for you in new projects) |

On each change `dev` rebuilds the server, regenerates the typed client **only when
the schema changes**, rebuilds the page bundles, and restarts — a failed build
leaves the last good server running. See [The Pylon App](/docs/core-concepts/the-pylon-app).

## pylon build

Compile the project once into `./.pylon` (no watch). Use this in CI and image
builds. The build runs in order: server bundle → generated client (when the schema
changed) → page bundles.

```bash
pylon build
```

The output is self-contained; run it with the command your serve plugin expects
(for example `node .pylon/index.js`). See [Deployment](/docs/production/deployment).

## pylon worker

Bundle and run a [queue worker](/docs/queues/overview). The worker entry imports
your app to register queues and processors, then starts the workers and drains the
outbox.

```bash
pylon worker
pylon worker -e ./src/worker.ts -o ./.pylon/worker.js
```

| Option | Default | Description |
| --- | --- | --- |
| `-e, --entry <path>` | `./src/worker.ts` | Worker entry to bundle |
| `-o, --output <path>` | `./.pylon/worker.js` | Bundle output path |
| `-c, --command <cmd>` | runtime default | Command that runs the bundle |

Run it alongside your app — same image, different command.

## pylon pull

Introspect a remote GraphQL API and generate a typed [gateway](/docs/core-concepts/the-pylon-app)
registry, so you can call the upstream API with full type safety from your
resolvers.

```bash
pylon pull https://api.example.com/graphql -n example -o ./src/generated
```

| Option | Default | Description |
| --- | --- | --- |
| `<url>` | — | Remote GraphQL endpoint (required) |
| `-n, --name <name>` | — | Name for the generated registry |
| `-o, --output <dir>` | `./src/generated` | Output directory |

## pylon db

Database migrations and schema management. See [Migrations](/docs/data/migrations)
for the full workflow.

| Command | Description |
| --- | --- |
| `pylon db status` | Show pending model changes and unapplied migrations |
| `pylon db diff [name] [--app a] [--rename] [--rename-table]` | Generate a migration from model changes; `--rename table.old=table.new` / `--rename-table Old=New` make a rename data-preserving instead of drop+create |
| `pylon db plan [--down]` | Print the SQL a migration would run (`--down` for the reverse) |
| `pylon db check` | CI gate: fail on uncaptured changes, drift, or tampered history |
| `pylon db migrate` | Apply unapplied migrations |
| `pylon db deploy` | Production apply — refuses to run on uncaptured model changes |
| `pylon db rollback [--steps n]` | Reverse the last `n` migrations (default 1) |
| `pylon db resolve <name> [--rolled-back]` | Mark a migration applied / rolled-back without running SQL |
| `pylon db seed [--seed path]` | Run the seed script (default `./src/seed.ts`) |
| `pylon db baseline [name]` | Adopt an existing database into migrations |
| `pylon db merge` | Reconverge divergent migration heads |
| `pylon db squash` | Collapse migration history into a single migration |
| `pylon db push` | Sync models straight to the database (prototyping and tests only) |

**Shared flags**

| Flag | Default | Description |
| --- | --- | --- |
| `-e, --entry <path>` | `./src/index.ts` | Entry that constructs your app / registers its models (`-m, --models` is a deprecated alias) |
| `-d, --dir <path>` | `./migrations` | Migration directory (single-app; apps declare their own via `db.migrations`) |

`migrate`, `deploy`, `rollback`, and `seed` connect to the database and require
`DATABASE_URL`. `diff`, `plan`, `status`, and `squash` work from the models and
migration files alone.

```bash
# typical local workflow
pylon db diff add-tasks
pylon db migrate

# CI
pylon db check
pylon db deploy

# prototyping / test setup
pylon db push
```

In an [apps](/docs/apps/overview) project, scope a diff to one app with `--app`;
`pylon db migrate` applies every app in cross-app dependency order.

## Scaffolding a project

`create-pylon` generates a new project. Invoke it through your package manager;
omit flags to be prompted interactively.

```bash
npm create pylon@latest
npm create pylon@latest my-app -- -r node --features pages
```

Or run the binary directly:

```bash
create-pylon my-app -r node --features auth,pages
```

| Option | Values | Description |
| --- | --- | --- |
| `[target]` | a directory name | Where to scaffold (prompted if omitted) |
| `-r, --runtime <runtime>` | `node` · `bun` · `deno` · `cf-workers` | Target runtime |
| `--features <list>` | `auth` · `pages` | Comma-separated features to include |

The available features depend on the runtime. See
[Runtimes](/docs/production/runtimes).
