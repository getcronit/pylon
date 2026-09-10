---
title: Why Pylon
nav: Why Pylon
description: The case for a type-driven fullstack framework — one source of truth a compiler can verify across every layer.
section: Introduction
order: 1
---

Pick almost any production TypeScript backend and you'll find the same shape: a
GraphQL or REST server, an ORM, a queue, an auth layer, a client-codegen step,
and — in a separate repo — a frontend. Six tools, six mental models, six places
your data is described. The job stops being "build the feature" and becomes
"keep six descriptions of the feature in agreement."

Pylon takes a different bet: **describe your data once, in types, and derive
everything else.**

## The cost of saying it twice

When the schema, the database, and the client are separate artifacts, they drift.
You rename a field in the ORM and forget the GraphQL type. You add a non-null
column and the client keeps treating it as optional. None of these are caught
until something breaks — at runtime, often in production.

The usual mitigations are more tools: codegen to sync the client, a linter to
catch the schema, a migration check in CI. Each one is a patch over the same
underlying problem — that the truth lives in more than one place.

Pylon removes the problem instead of patching it. There is exactly one
description of `User`: the TypeScript that defines it. The GraphQL type, the
database table, and the client type are all *projections* of that one
description. They can't disagree, because there's nothing to disagree with.

:::tip[The one-line version]
tRPC's developer experience, a real GraphQL API, and the backend pieces you'd
otherwise assemble by hand — derived from one set of types a compiler checks.
:::

## What you get out of the box

- **A real GraphQL API** — introspectable, federatable, playground-equipped — with
  none of the SDL or resolver-binding boilerplate. See
  [Type-Driven Schema](/docs/core-concepts/type-driven-schema).
- **An ORM that can't drift from the API** — the class you query is the type you
  return. See [Data](/docs/data/overview).
- **Authorization at the data layer** — [row-level policies and tenant scoping](/docs/data/policies)
  apply to every query and every relation traversal, so they can't be forgotten.
- **Background work without a second framework** — [typed queues, cron, and a
  transactional outbox](/docs/queues/overview).
- **A frontend in the same project** — [usePages](/docs/frontend/overview) renders
  React server-side and fetches exactly the data each page reads, with no query
  written by hand and no separate deployment.

## Built for a compiler — and for agents

There's a second reason to put everything behind one verifiable model, and it's
becoming the more important one. AI agents now write a large and growing share of
application code. An agent is only as safe as the feedback it gets, and the best
feedback is a compiler that can prove a change is consistent before it runs.

A Pylon codebase gives exactly that. Because the API, the data layer, and the
client are derived from the same types, a change an agent makes in one place is
checked against every other place — automatically, at build time. The same
property that makes Pylon pleasant for humans to refactor makes it *safe* for
agents to build in.

That's the framework Pylon is built to be: one model, checked by the compiler,
for the whole stack.

Ready to try it? [Get started](/docs/getting-started) →
