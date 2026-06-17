---
title: Migrations
description: Generate, review, and apply schema migrations from your models with the pylon db CLI.
section: Data — pylon-db
order: 8
---

Pylon's migrations are **authored** — generated from the diff between your models
and the last migration, written to a file you can read and edit, then applied
explicitly. The CLI never runs your application to do this, so migrations are
safe to run in CI and production.

## The workflow

```bash
# 1. generate a migration from model changes
pylon db diff init

# 2. preview the SQL it will run
pylon db plan

# 3. apply unapplied migrations (needs DATABASE_URL)
pylon db migrate
```

Migrations live in `./migrations` and are named `<timestamp>_<name>.ts`.

## Authored migration files

A generated migration exports a `defineMigration` with an ordered list of
operations. Schema operations are automatically reversible:

```ts
import {migrations} from '@getcronit/pylon-db'

export default migrations.defineMigration({
  operations: [
    migrations.createTable({
      name: 'User',
      table: 'user',
      columns: [
        {property: 'id', name: 'id', sqlType: 'bigint', primaryKey: true, autoIncrement: true, nullable: false},
        {property: 'email', name: 'email', sqlType: 'text', unique: true, nullable: false}
      ]
    }),
    migrations.addForeignKey({
      table: 'post',
      name: 'post_author_id_fkey',
      column: 'author_id',
      refTable: 'user',
      refColumn: 'id'
    })
  ]
})
```

Available operations include `createTable`, `dropTable`, `addColumn`,
`dropColumn`, `alterColumn`, `renameColumn`, `addForeignKey`, `dropForeignKey`,
`addIndex`, and `dropIndex`.

## Data migrations

For changes that move data, use `runSql` (raw SQL) or `run` (code). Both are
reversible when you provide a `down`:

```ts
export default migrations.defineMigration({
  operations: [
    migrations.runSql(
      `INSERT INTO "category" ("name") VALUES ('Books'), ('Toys')`,
      {down: `DELETE FROM "category" WHERE "name" IN ('Books', 'Toys')`}
    )
  ]
})
```

`run` handlers receive the database plus the models **as they existed at this
migration** (reconstructed from history, never your live model code), so old data
migrations keep working even after your models evolve:

```ts
migrations.run({
  up: async ({db, models}) => {
    const Product = models.get('Product')
    const count = await db.run(() => Product.objects.count())
    // ...
  },
  down: async ({db, models}) => {
    // reverse it
  }
})
```

## Renames

A diff sees a renamed column as a drop plus an add, which would lose data. Confirm
the rename to preserve it:

```bash
pylon db diff rename_email --rename user.email=user.email_address
```

## CLI reference

| Command | What it does |
| --- | --- |
| `pylon db diff [name]` | Generate a migration from model changes |
| `pylon db status` | Show pending changes and unapplied migrations |
| `pylon db plan [--down]` | Print the SQL a migration would run |
| `pylon db migrate` | Apply unapplied migrations |
| `pylon db rollback [-s n]` | Reverse the last `n` migrations |
| `pylon db check` | CI gate: fail on uncaptured changes, drift, or tampering |
| `pylon db deploy` | Production apply (refuses on uncaptured changes) |
| `pylon db seed` | Run `./src/seed.ts` |
| `pylon db baseline` | Adopt an existing database into migrations |
| `pylon db squash` | Collapse history into a single migration |
| `pylon db merge` | Reconverge divergent migration heads |
| `pylon db resolve <name>` | Mark a migration applied / rolled-back without running SQL |
| `pylon db push` | Sync models straight to the DB (prototyping only) |

Most commands accept `-m, --models <path>` (default `./src/index.ts`) and
`-d, --dir <path>` (default `./migrations`).

## CI and production

Run `pylon db check` in CI to fail the build when models have changed but no
migration was generated, when applied migrations were edited after the fact, or
when the database has drifted. In production, `pylon db deploy` applies pending
migrations and refuses to run if uncaptured changes exist.

When you use [apps](/docs/apps/overview), migrations are organized per app under
`migrations/<app>/` and applied in dependency order inferred from cross-app
foreign keys. Generate one app's migration with `pylon db diff -a <app>`.
