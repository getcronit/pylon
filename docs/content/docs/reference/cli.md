---
title: CLI Reference
description: Every pylon command — dev, build, worker, pull, inspect, verify, mcp, db, and project scaffolding.
section: Reference
order: 0
---

The Pylon CLI ships in `@getcronit/pylon/dev` and is invoked as `pylon`. It drives
the type-introspecting build, the dev loop, queue workers, remote-API gateways,
and database migrations. Commands that touch the database read `DATABASE_URL`.

## pylon dev

Start the development loop: type-introspect the schema, build the server and pages,
watch your source, and restart the app with a browser live-reload on every change.
Live-reload is served over SSE on `PORT + 1`.

```bash
pylon dev
pylon dev -c "bun run .pylon/server.mjs"
```

| Option | Default | Description |
| --- | --- | --- |
| `-c, --command <cmd>` | runs `.pylon/server.mjs` through the built-in tsx loader | Command that runs the app in dev. On Node, omit it and use the default; new projects set it per runtime (e.g. `bun run .pylon/server.mjs`, `deno run -A --unstable-sloppy-imports .pylon/server.mjs`, `wrangler dev`). |
| `--worker` | _(off)_ | Run a background [queue worker](/docs/queues/overview) instead of the web server — consume queues + drain the outbox, no HTTP, from source with watch/restart. Production equivalent: `node .pylon/worker.mjs`. |
| `--inspect [port]` | `9229` | Open the Node inspector on the dev process for breakpoint debugging (see below). |
| `--inspect-brk [port]` | `9229` | Like `--inspect`, but wait for a debugger to attach before booting. |

### Run a worker in dev

`pylon dev --worker` boots your app in *worker role* (`PYLON_ROLE=worker`) from
source and restarts on `src`/`pylon.config` changes — the dev twin of production's
`node .pylon/worker.mjs`. It consumes queues and drains the outbox but serves no
HTTP: `executeConfig` gates out the web-only plugins (`usePages`, `useNodeServer`)
by role, so the worker never binds a port or imports the frontend. Run it in a
second terminal next to `pylon dev`, or on its own to work jobs in isolation.

On each change `dev` rebuilds the server, regenerates the typed client **only when
the schema changes**, rebuilds the page bundles, and restarts — a failed build
leaves the last good server running. See [The Pylon App](/docs/core-concepts/the-pylon-app).

### Debugging with a breakpoint

`pylon dev` runs your resolvers **in-process**, so pass `--inspect` and breakpoints
in your resolver and route code bind directly:

```bash
pylon dev --inspect          # inspector on 127.0.0.1:9229
pylon dev --inspect 9230     # …or a port you choose
pylon dev --inspect-brk      # wait for a debugger to attach before booting
```

Then open `chrome://inspect` (or your editor's "Attach to Node" launch config) and
you'll find a single clean target on the app process. `--inspect` opens the inspector
on the dev process itself, so it works the same through a package manager
(`pnpm pylon dev --inspect`) and never fights the bundler's worker threads for the
port.

:::warning[Use the flag, not `NODE_OPTIONS`]
`NODE_OPTIONS='--inspect' pnpm pylon dev` looks equivalent but isn't: `pnpm` is a
Node process too, so it grabs the inspector port **first** and your debugger attaches
to the package-manager wrapper — which holds none of your code, so breakpoints never
bind. `pylon dev --inspect` opens the inspector on the right process directly.
:::

## pylon build

Compile the project once into `./.pylon` (no watch). Use this in CI and image
builds. The build runs in order: server glue + transpiled source → generated client
(when the schema changed) → page bundles.

```bash
pylon build
```

The output is **unbundled** — run `.pylon/server.mjs` with the command your serve
plugin expects (for example `node .pylon/server.mjs`), alongside your production
`node_modules`. See [Deployment](/docs/production/deployment).

## Running a queue worker

There is no `pylon worker` command and no worker entry to author. The worker is the
same app in a different run-role:

- **Dev:** `pylon dev --worker` (see [above](#run-a-worker-in-dev)).
- **Production:** `node .pylon/worker.mjs` — emitted by `pylon build` next to
  `server.mjs`.

Both boot your app + `pylon.config` in *worker role*; `executeConfig` skips the
web-only plugins so the worker consumes queues without serving HTTP. See
[queues](/docs/queues/overview) and [deployment](/docs/production/deployment).

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

## pylon inspect

Serialize the **app model** — the canonical, machine-readable description of your app:
its GraphQL schema, persisted entities (columns, relations, indexes), queues, and
per-model authorization. `inspect` is static: it type-introspects and runs the app's
build-safe hooks (models, plugin manifest), so it never connects to the database or
starts a server. The output is canonicalized (sorted), so it is byte-stable and
diffable across builds.

```bash
pylon inspect            # full AppModel as JSON (default)
pylon inspect --sdl      # GraphQL schema only
pylon inspect --ddl      # Postgres DDL only
```

| Option | Default | Description |
| --- | --- | --- |
| `--json` | on | Emit the full `AppModel` as JSON |
| `--sdl` | — | Emit the GraphQL schema (SDL) |
| `--ddl` | — | Emit the Postgres DDL |
| `-e, --entry <path>` | `./src/index.ts` | Entry that constructs your app / registers models (`-m, --models` is a deprecated alias) |

Use it to snapshot your API surface in CI, feed a diff tool, or drive code generation
from a single source of truth.

## pylon verify

Run the layered checks — build, typecheck, and migration check — and print a
**stratified verdict**: `pass`, `review`, or `fail`. This is the one-command contract
for "is this app in a shippable state?", designed for CI and agents.

```bash
pylon verify
pylon verify --json     # { verdict, checks } — lean payload for agents
```

| Option | Default | Description |
| --- | --- | --- |
| `--json` | — | Emit the verdict and per-check results as JSON |
| `-e, --entry <path>` | `./src/index.ts` | Entry that constructs your app / registers models (`-m, --models` is a deprecated alias) |

Exits non-zero on a `fail` verdict (a `review` still exits 0). The default output lists
each check with a pass/fail/warn mark; `--json` returns `{ verdict, checks }` — the
full app model is a separate [`inspect`](#pylon-inspect) call.

## pylon mcp

Run the Pylon [MCP](https://modelcontextprotocol.io) server over stdio, exposing the app
model to an agent as four tools: `describe_app`, `get_entity`, `get_operation`, and
`verify`. Point an MCP client (e.g. Claude Code) at `pylon mcp` so the agent can read
your real schema, entities, and authorization instead of guessing — and self-check its
work with `verify`.

```bash
pylon mcp
pylon mcp -c ./packages/api    # inspect a project in another directory
```

| Option | Default | Description |
| --- | --- | --- |
| `-c, --cwd <dir>` | `.` | Project root to inspect — resolved independently of the launch directory, so an MCP client config never depends on where it was started |
| `-e, --entry <path>` | `./src/index.ts` | Entry that constructs your app / registers models (`-m, --models` is a deprecated alias) |

`stdout` carries the MCP protocol stream, so run it as a server your client spawns, not
interactively.

## pylon db

Database migrations and schema management. See [Migrations](/docs/data/migrations)
for the full workflow.

| Command | Description |
| --- | --- |
| `pylon db status` | Show pending model changes and unapplied migrations |
| `pylon db diff [name] [--app a] [--rename] [--rename-table]` | Generate a migration from model changes; `--rename table.old=table.new` / `--rename-table Old=New` make a rename data-preserving instead of drop+create |
| `pylon db plan [--down]` | Print the SQL a migration would run (`--down` for the reverse) |
| `pylon db check` | CI gate: fail on uncaptured changes, drift, tampered history, or an undeclared cross-app dependency edge |
| `pylon db fix-deps [--write]` | Find (with `--write`, backfill) cross-app dependency edges a migration references but doesn't declare — the edges that order a from-scratch apply (`db reset`) |
| `pylon db migrate [--create-db] [--check]` | Apply unapplied migrations. `--create-db` creates the database first if missing (development only — never in production, where a missing database usually means `DATABASE_URL` is wrong). `--check` refuses to apply while models have changes no migration captures |
| `pylon db rollback [--steps n] [--app a]` | Reverse the last migration — or the whole cross-app cluster it belongs to. `--steps n` reverses the last `n` regardless of clustering; `--app` scopes to one app's sequence |
| `pylon db resolve <name> [--rolled-back]` | Mark a migration applied / rolled-back without running SQL |
| `pylon db rename-app <old=new>` | Re-point the migration ledger after renaming an [app](/docs/apps/overview) in code (run once per database, before `migrate`) |
| `pylon db seed [--seed path]` | Run the seed script (default `./src/seed.ts`) |
| `pylon db baseline [name]` | Adopt an existing database into migrations |
| `pylon db merge` | Reconverge divergent migration heads |
| `pylon db squash` | Collapse migration history into a single migration |
| `pylon db push` | Sync models straight to the database (prototyping and tests only) |
| `pylon db reset [--seed] [--force]` | **Destructive (dev):** drop every table and re-apply all migrations from scratch. Prompts to confirm and refuses in production unless `--force`; `--seed` runs the seed file afterward |

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
pylon db migrate --check

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
