---
title: Pylon — Write TypeScript. Ship the whole stack.
description: Marketing copy for the Pylon landing page. This file is the source of truth; the React landing page (docs/pages/page.tsx) mirrors it section by section.
---

<!--
  This is landing-page copy, organized in the order it appears on the page.
  Each "## section" maps to one block in docs/pages/page.tsx. Keep them in sync.
-->

## Hero

**Eyebrow:** The type-driven fullstack framework

**Headline:** Write TypeScript. Ship the whole stack.

**Subhead:** Pylon turns plain TypeScript into a production GraphQL API, an ORM,
queues, auth, and a React frontend — all derived from your types. Because it's
derived, it can't drift, and every change is verified across every layer. One
model, checked by the compiler.

**Primary CTA:** Get started → `/docs/getting-started`
**Secondary:** `npm create pylon@latest`

**Hero demo — TypeScript in, GraphQL out:**

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'

class User {
  id!: string
  name!: string
  email!: string | null
}

export default new Pylon({
  graphql: {
    Query: {
      user: (id: string): User => ({id, name: 'Ada', email: null})
    }
  }
})
```

→ Pylon generates →

```graphql title="schema.graphql"
type User {
  id: String!
  name: String!
  email: String
}

type Query {
  user(id: String!): User
}
```

**Runs anywhere:** Node.js · Bun · Deno · Cloudflare Workers

---

## Big picture

**Heading:** The whole system, from your types

**Body:** One TypeScript codebase. A compiler derives the API, the database, and
the frontend — and proves they stay consistent.

**Footnote:** One model a compiler can check is also the soundest foundation to
build on — for your team, and for the AI agents working alongside it. That's the
direction Pylon is built for.

---

## Features

**Heading:** One framework, not six libraries

**Body:** Everything you'd stitch together by hand — schema, data, auth,
background jobs, frontend — comes from one type-driven toolchain.

1. **Type-driven schema** — Write functions and classes. Pylon introspects their
   TypeScript types and generates a complete GraphQL schema — no SDL, no
   decorators, no codegen to babysit.
2. **Batteries-included ORM** — Models, relations, migrations, validation, and
   lifecycle signals — a Prisma-class data layer that ships in the box and never
   drifts from your API.
3. **Policies & multi-tenancy** — Row-level access policies and tenant scoping
   live at the data layer, so they apply to every query and relation — impossible
   to forget.
4. **Job queues** — Define typed queues, processors, and cron jobs with a
   transactional outbox for exactly-once delivery — background work without a
   second framework.
5. **usePages frontend** — A file-based React frontend with build-time query
   analysis: every page fetches exactly the data it renders, server-rendered and
   hydrated.
6. **Composable apps** — Bundle models, migrations, and resolvers into modular
   apps with cross-app relations — Django-style structure for a TypeScript stack.

---

## usePages showcase

**Badge:** Frontend included · usePages

**Heading:** Your frontend, type-connected

**Body:** usePages is a server-rendered React frontend that lives in your Pylon
app. It reads your GraphQL schema with full type-safety — and generates the exact
data query for every page at build time.

**Left — the API:**

```ts title="src/index.ts"
class Post {
  id!: string
  title!: string
}

export default new Pylon({
  graphql: {
    Query: {
      posts: (): Post[] => Post.objects.all()
    }
  }
})
```

**Right — the page:**

```tsx title="pages/page.tsx"
function Posts() {
  const data = useData()

  return data.posts.map(p => (
    <Link href={'/posts/' + p.id}>{p.title}</Link>
  ))
}
```

**Callout:** Pylon sees the page reads `id` and `title`, and generates
`{ posts { id title } }` — at build time. No query written by hand, and never
more than the page renders.

**Three points:**
- **One app, one deploy** — API and frontend are the same project — no separate
  client, no CORS, no second deployment.
- **No queries to write** — Read fields off a typed proxy; Pylon generates the
  minimal query for each page.
- **Server-rendered** — Each request renders with its data resolved, then hydrates
  instantly on the client.

**Link:** Explore usePages → `/docs/frontend/overview`

---

## Comparison

**Heading:** How Pylon compares

**Body:** tRPC's developer experience. A real GraphQL API. A backend that ships
with the parts you'd otherwise assemble yourself.

| | Pylon | tRPC | GraphQL (Nexus/Pothos) | Prisma + Apollo |
|---|---|---|---|---|
| Type-driven, no schema to write | ✓ | ✓ | partial | — |
| Real GraphQL API | ✓ | — | ✓ | ✓ |
| ORM in the box | ✓ | — | — | ✓ (separate) |
| Row-level policies & multi-tenancy | ✓ | — | — | — |
| Background jobs / queues | ✓ | — | — | — |
| Frontend with auto-generated queries | ✓ | partial | — | — |
| One deployment, no client codegen step | ✓ | ✓ | — | — |

**Footnote:** Comparison reflects each tool's primary, out-of-the-box design —
many gaps can be closed with additional libraries.

---

## CTA

**Heading:** Build your next API in minutes

**Body:** Scaffold a project, write a function, and get a typed GraphQL API with a
playground — instantly.

**Primary:** Read the docs → `/docs/getting-started`
**Secondary:** Star on GitHub → `https://github.com/getcronit/pylon`
