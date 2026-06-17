---
title: Introduction
nav: Introduction
description: Pylon turns plain TypeScript into a production GraphQL API, an ORM, queues, auth, and a React frontend.
section: Introduction
order: 0
---

# Introduction

Most backends make you say everything twice. You describe your data in a schema
language, then again in your resolvers, then again in your database migrations,
and then a fourth time in your client types. Every layer is a chance for them to
drift apart.

**Pylon collapses those layers.** You write plain TypeScript functions and
classes — Pylon introspects their types and generates a real GraphQL API from
them. No SDL to maintain, no decorators, no codegen step you have to remember to
run.

## The whole stack from your types

```ts
import {Pylon} from '@getcronit/pylon'

class User {
  id!: string
  name!: string
  email!: string | null
}

export default new Pylon({
  graphql: {
    Query: {
      user: (id: string): User | null => ({id, name: 'Ada', email: null})
    }
  }
})
```

That's a complete, introspectable GraphQL API. The `User` class becomes a GraphQL
type, the function signature becomes a field with a typed argument, and the
return type wires it all together.

## Who it's for

Pylon is built for TypeScript teams who want **tRPC-level developer experience**
but a **real, public GraphQL API** — and a batteries-included backend (ORM,
queues, auth, multi-tenancy) without stitching six libraries together.
