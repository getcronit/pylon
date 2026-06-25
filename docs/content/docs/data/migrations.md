---
title: Migrations
nav: Migrations
description: Sync your schema directly in dev with db push, or generate versioned migrations with a ledger for production.
section: Data — pylon-db
order: 6
---

Your models are the source of truth for the schema. `pylon db` keeps the
database in step with them through two workflows: **push** for fast iteration in
development, and **versioned migrations** with a ledger for everything that has
to be reproducible. You run the same CLI in both modes — the difference is
whether a change is captured as a file.

## Push: sync directly (development)

`pylon db push` reads your models and applies the schema straight to the
database — no migration file, no ledger. It's the fastest loop while a schema is
still in flux:

```bash
pylon db push
```

Edit a model, push again, and the table reshapes to match. Push is for
development databases you can rebuild at will. **Don't push to production** —
there's no record of what changed and no rollback.

## Migrations: capture and apply (production)

For production you capture each change as a versioned file. `pylon db diff`
compares your models against the migration history and writes a new migration;
`pylon db migrate` applies the pending ones, recording each in a ledger so it
runs exactly once.

```bash
# 1. generate a migration from the model diff
pylon db diff add_user_table

# 2. review the generated file under ./migrations, then apply
pylon db migrate
```

In production, run `pylon db deploy` instead of `migrate` — it applies pending
migrations from the ledger without consulting the live models, so deploys are
deterministic:

```bash
pylon db deploy
```

## The workflow commands

| Command | What it does |
| --- | --- |
| `pylon db diff [name]` | generate a migration from the model ↔ history diff |
| `pylon db migrate` | apply pending migrations (dev) |
| `pylon db deploy` | apply pending migrations from the ledger (production) |
| `pylon db status` | show applied vs pending migrations |
| `pylon db check` | fail if models have uncaptured changes — a CI gate |
| `pylon db rollback` | reverse the last migration (`--steps <n>` for more) |
| `pylon db baseline` | adopt an existing database as the starting point |
| `pylon db seed` | run your seed file |
| `pylon db squash` | collapse a range of migrations into one |
| `pylon db merge` | reconcile divergent migration histories |

Common flags: `-m, --models <path>` (the entry that imports your models,
defaults to `./src/index.ts`) and `-d, --dir <path>` (the migrations directory,
defaults to `./migrations`).

## Guard CI with `check`

`pylon db check` fails when your models contain changes no migration has
captured. Run it in CI to make "you changed a model but forgot to generate a
migration" a red build:

```bash
pylon db check   # non-zero exit if a migration is missing
```

## Apps mode

When you split your backend into [apps](/docs/apps/overview), each app is its own
migration group. A **named** `Pylon` tags every model it owns, and `pylon db`
derives the groups and orders them by their dependencies (inferred from
cross-app foreign keys, plus any explicit `dependsOn`). Each group keeps its own
ledger.

```ts title="src/apps/blog/index.ts"
import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon-db'

export class Post extends models.Model {
  static objects = db.manager(Post)
  id = models.ID()
  title = models.Text()
}

// the app's name is the migration group (and prefixes the table → blog_post)
export const blog = new Pylon({name: 'blog', db: {models: [Post]}})
```

Run a command across every app, or scope `diff` to one with `--app`:

```bash
pylon db diff --app blog add_post_table   # generate for the blog app only
pylon db migrate                          # applies every app's pending migrations,
                                          # in dependency order
```

`pylon db status` reports each group's applied and pending migrations
separately, so you can see exactly where each app stands.
