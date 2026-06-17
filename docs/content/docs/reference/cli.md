---
title: CLI Reference
description: Every pylon command — dev, build, db, pull, and worker.
section: Reference
order: 0
---

The Pylon CLI ships in `@getcronit/pylon-dev` and is invoked as `pylon`.

## pylon dev

Start the development server: watch your source, rebuild the schema, regenerate
the typed client, and restart the app on change.

```bash
pylon dev -c "node --enable-source-maps .pylon/index.js"
```

- `-c, --command <cmd>` — the command that runs the built app (varies by runtime;
  set for you in new projects).

## pylon build

Compile the project once into `.pylon/` (no watch). Use this in CI and image
builds.

```bash
pylon build
```

## pylon pull

Fetch a remote GraphQL schema and generate typed [gateway](/docs/core-concepts/gateway)
bindings.

```bash
pylon pull <url> -n <name> -o <output-dir>
```

- `-n, --name <name>` — name for the generated registry
- `-o, --output <dir>` — output directory

## pylon worker

Bundle and run a worker entry that consumes [queues](/docs/queues/overview) and
relays the outbox.

```bash
pylon worker -e ./src/worker.ts
```

- `-e, --entry <path>` — worker entry (default `./src/worker.ts`)
- `-o, --output <path>` — bundle output (default `./.pylon/worker.js`)
- `-c, --command <cmd>` — command that runs the bundle

## pylon db

Database migrations. See [Migrations](/docs/data/migrations) for the full
workflow.

| Command | Description |
| --- | --- |
| `pylon db diff [name]` | Generate a migration from model changes |
| `pylon db status` | Show pending changes and unapplied migrations |
| `pylon db plan [--down]` | Print the SQL a migration would run |
| `pylon db migrate` | Apply unapplied migrations |
| `pylon db rollback [-s n]` | Reverse the last `n` migrations |
| `pylon db check` | CI gate: fail on uncaptured changes, drift, or tampering |
| `pylon db deploy` | Production apply (refuses on uncaptured changes) |
| `pylon db seed` | Run `./src/seed.ts` |
| `pylon db baseline [name]` | Adopt an existing database into migrations |
| `pylon db squash [name]` | Collapse history into a single migration |
| `pylon db merge [name]` | Reconverge divergent migration heads |
| `pylon db resolve <name>` | Mark a migration applied / rolled-back without SQL |
| `pylon db push` | Sync models straight to the DB (prototyping only) |

Shared flags: `-m, --models <path>` (default `./src/index.ts`) and
`-d, --dir <path>` (default `./migrations`). Commands that touch the database
require `DATABASE_URL`.
