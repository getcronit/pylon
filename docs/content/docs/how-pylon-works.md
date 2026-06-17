---
title: How Pylon Works
description: The type-introspection compiler — how one set of TypeScript types becomes your API, your database, your client, and your UI's data layer.
section: Introduction
order: 2
nav: How it works
---

Most backends make you describe your data several times over: once in a schema
language, again in resolvers, again in database migrations, and again in your
client's types. Every copy is a chance for them to drift apart, and keeping them
in sync is a tax you pay on every change.

Pylon removes the copies. It reads your TypeScript types **once**, builds a single
internal description of your system, and **projects that description** into every
artifact you need. This page explains how.

## One source, many projections

At the center of Pylon is an **intermediate representation** (IR): a normalized,
serializable description of your types, operations, and database entities. The
compiler derives the IR from your TypeScript, and everything else is a pure
projection of it:

```
  your TypeScript
  ┌─────────────────────────────┐
  │ new Pylon({ graphql: {…} })  │   resolvers (functions & classes)
  │ @model class User extends …  │   data models
  └──────────────┬──────────────┘
                 │   TypeScript compiler (type checker)
                 ▼
        ┌──────────────────┐
        │   Pylon IR        │   one normalized, serializable model
        └───┬───┬───┬───┬──┘
            │   │   │   │
   ┌────────┘   │   │   └─────────────┐
   ▼            ▼   ▼                 ▼
GraphQL      SQL   Migrations     Typed client
 schema      DDL    (IR diff)     (gqty) ──► usePages
                                              per-page query
```

Because every output reads the same IR, they can't disagree. A rename is just a
rename; a breaking change is a TypeScript error at build time.

## Reading your types

When you run `pylon build` (or `pylon dev`), Pylon starts a TypeScript program
over your source and uses the **type checker** — the same engine your editor uses
— to inspect the `graphql` export. It doesn't parse text or rely on decorators
for the API; it asks the compiler what the types actually are.

From those types it infers the whole GraphQL shape:

- a function's parameters become **arguments**, its return type becomes the
  **field type**;
- a class becomes an **object type**, its public fields become **fields**;
- `T | null` becomes a **nullable** field, `T[]` a **list** (with nesting
  preserved — `number[][]` is `[[Int!]!]!`, not a flat list);
- `Promise<T>` is awaited to `T`;
- class **inheritance** becomes a GraphQL **interface**;
- a **union type** becomes a GraphQL **union**, with the `__resolveType`
  discriminator generated for you;
- a **string-literal union** (`'ADMIN' | 'READER'`) becomes an **enum**.

No SDL, no schema builder, no decorators on your resolvers. The schema is a fact
about your code, derived from it.

## Where the database comes from

Your [models](/docs/data/models) are TypeScript classes too. The compiler runs
their definitions to populate a registry, then asks the ORM to contribute its
own slice of the IR: each model becomes an **entity** with precise SQL columns,
relations, indexes, and a primary key.

The two contributions — the API types inferred from the type checker, and the
entities described by the ORM — are **merged into one IR**. For a persisted type,
the ORM's column and relation metadata is authoritative (it knows the SQL
intent — a primary key is an `ID`, a `numeric` is a decimal), while computed
methods on the model are folded in as extra fields. The result: a single `User`
that is **both a GraphQL type and a database table**, described once.

## Projecting the IR

With one IR in hand, each output is a small, pure function over it:

- **GraphQL schema** — the IR renders to SDL, which becomes the schema your
  server serves and your playground introspects.
- **SQL & migrations** — the IR's entities render to DDL. Migrations are computed
  by **diffing two IR snapshots** (your last migration vs. your current models),
  not by inspecting a live database. That makes them reproducible, reviewable,
  and free of accidental drift — the CLI never has to run your app to generate
  them.
- **A typed client** — the schema generates a fully typed
  [gqty](https://gqty.dev) client, so the frontend accesses your API with
  autocomplete and type-checking.
- **Per-page queries** — in [usePages](/docs/frontend/use-pages), a build-time
  analyzer reads each component, sees exactly which fields and arguments it
  touches on the [`useData`](/docs/frontend/use-data) proxy, and generates the
  minimal query for that page. The type flow reaches all the way into your UI.

## Build time vs. runtime

All of this introspection happens at **build time**. `pylon build` produces a
`.pylon/` directory containing the schema, the generated client, and a bundled
server. At **runtime** there's no type reflection and no schema assembly on the
hot path — just a lean [Hono](https://hono.dev) app serving a precompiled schema.
That's why the same build runs unchanged on Node, Bun, Deno, and Cloudflare
Workers.

## Why this matters

The payoff isn't only less boilerplate — it's a category of bugs that simply
can't occur:

- Your API can't drift from your resolvers, because it's derived from them.
- Your database can't drift from your models, because it's the same IR.
- Your client can't drift from your API, because it's generated from the schema.
- A page can't over- or under-fetch, because its query is computed from what it
  renders.

You change a type in one place, and every layer that depends on it updates or
fails the build. That is the whole idea: **write TypeScript once, and let the
compiler keep the rest honest.**

Ready to see it in practice? Start with [Getting Started](/docs/getting-started),
or read about the [type-driven schema](/docs/core-concepts/type-driven-schema) in
detail.
