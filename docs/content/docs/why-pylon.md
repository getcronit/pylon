---
title: Why Pylon
description: Where Pylon fits — tRPC-level developer experience with a real GraphQL API and a batteries-included backend.
section: Introduction
order: 1
---

There are many ways to build a TypeScript backend. Pylon occupies a specific
spot: the **developer experience of writing plain functions**, combined with a
**real, introspectable GraphQL API** and the **batteries you'd otherwise
assemble yourself** — an ORM, queues, auth, and a frontend.

## The core idea

You write TypeScript. Pylon's compiler reads your types and generates the schema.
A rename is a TypeScript rename; a breaking change is a type error. There is no
SDL file, no decorator soup, and no codegen step you have to remember to run.

That same type-driven approach extends to the database: your models are
TypeScript classes, and they generate both your API types and your SQL schema.
One source of truth, all the way down.

## Derived, so it's verifiable

This is the part that matters most, and it's easy to miss. Because your whole app
is *derived* from one model rather than assembled from separate libraries, the
compiler can **prove a change is consistent** across the API, the database, and
the UI — or fail the build. Your API can't drift from your resolvers; your
database can't drift from your models; a page can't fetch a field that no longer
exists.

That's a different kind of guarantee than "it's type-safe." It's the difference
between a stack you *hope* stays in sync and one a compiler *checks*. And it's
exactly what makes Pylon a foundation you — and increasingly the AI agents working
alongside you — can build on without it quietly coming apart. A change either
derives correctly everywhere, or it doesn't ship.

## How it compares

**vs tRPC.** tRPC gives you the same "just write functions" feeling, but the
contract is private and TypeScript-only — there's no public, introspectable API
and no non-TS clients. Pylon gives you the same DX and emits a real GraphQL API
with a playground, introspection, and any-language clients.

**vs code-first GraphQL builders (Pothos, Nexus, TypeGraphQL).** These are
excellent, but you still describe the schema in a builder DSL or with decorators.
Pylon infers it from native TypeScript types — the least boilerplate in the
category.

**vs schema-first (Apollo, Yoga + SDL).** No SDL to write and keep in lockstep
with your resolvers.

**vs Hasura / PostGraphile.** Those derive the API from your database — superb
for CRUD, awkward for custom business logic. Pylon is code-first business logic,
and ships its own ORM so it owns the data layer without giving up schema control.

**vs Prisma.** Prisma is the ORM. `pylon-db` is an ORM *plus* the API layer,
row-level policies, multi-tenancy, signals, and migrations — in one toolchain.

**vs full-stack frameworks (RedwoodJS).** Pylon is lighter and type-driven rather
than Apollo/SDL-based, runs on Node, Bun, Deno, and Cloudflare Workers, and its
`usePages` frontend computes each page's data query at build time.

## Who it's for

Pylon is built for TypeScript teams who want to move fast without giving up a
real API — especially teams building **multi-tenant SaaS and B2B products** that
need an ORM, background jobs, authentication, and tenant isolation, and would
rather use one coherent toolchain than wire six libraries together.

## What you get

- A **type-driven GraphQL API** from plain functions and classes
- A **batteries-included ORM** with relations, migrations, validation, and signals
- **Row-level policies** and **multi-tenancy** at the data layer
- **Background queues** with a transactional outbox
- **OIDC authentication** and role-based guards
- A **server-rendered React frontend** with build-time data fetching
- **Multi-runtime** deployment: Node, Bun, Deno, Cloudflare Workers

Ready to build? Head to [Getting Started](/docs/getting-started).

---

### Notes on the comparison

The comparison reflects each tool's primary, out-of-the-box design; many gaps can
be closed with additional libraries. A few points worth grounding:

- tRPC deliberately omits a schema/introspection layer — it has no introspection
  query and is best suited to first-party TypeScript clients rather than public
  or polyglot APIs.
- Pothos and TypeGraphQL are code-first but still describe the schema explicitly
  (a builder API or decorators); Nexus is widely considered to have slowed, with
  Pothos the common recommendation today.
- Hasura and PostGraphile generate the GraphQL API from your Postgres schema —
  excellent for CRUD, with business logic added alongside.
- RedwoodJS combines React, GraphQL (Apollo), and Prisma, and has since added a
  background-jobs feature.

Sources: [Better Stack — tRPC vs GraphQL](https://betterstack.com/community/guides/scaling-nodejs/trpc-vs-graphql/),
[Pothos](https://pothos-graphql.dev/),
[Nexus maintenance discussion](https://github.com/graphql-nexus/nexus/issues/1139),
[Hasura on Postgres](https://hasura.io/graphql/database/postgresql),
[PostGraphile](https://postgraphile.org/).
