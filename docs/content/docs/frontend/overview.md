---
title: Overview
nav: Overview
description: A server-rendered React frontend that lives inside your Pylon app, fetches exactly what each page renders, and ships in one deploy.
section: Frontend — usePages
order: 0
---

usePages is the frontend half of Pylon's single-source-of-truth story. It's a
server-rendered React app that runs **inside your Pylon process**, reads from
**your** GraphQL schema with full type safety, and generates the exact data
query for every page at build time. One project, one type system, one deploy.

The type-introspection compiler already connects your TypeScript to your API and
your database. usePages extends that same connection all the way to the screen —
so a field you rename in a resolver breaks the page that reads it, at compile
time.

## The pitch

- **One app, one deploy, no CORS.** Your API and your frontend are the same
  project. There's no separate client app, no API base URL to configure, no
  second deployment, no cross-origin setup.
- **You don't write queries.** You read typed fields off a proxy with
  [`useData`](/docs/frontend/use-data); the build step sees exactly what each
  page renders and compiles the minimal GraphQL document for it. No documents to
  maintain, no over- or under-fetching.
- **Server-rendered, instantly hydrated.** Each request renders on the server
  with its data already resolved, then serializes that result into the page so
  the client hydrates with zero extra round-trips.
- **Familiar and minimal.** File-based routing, nested layouts, `Link`, and
  first-class [Tailwind](/docs/frontend/styling) — the conventions you already
  know.

## What a page looks like

A page is a default-exported React component. It reads data with `useData` —
never a query string, just the fields:

```tsx title="pages/posts/page.tsx"
import {Link, useData, type PageProps} from '@getcronit/pylon/pages'

export default function PostsPage({}: PageProps) {
  const data = useData()
  const posts = data.posts // typed from your backend's schema

  return (
    <ul>
      {posts.map(post => (
        <li key={post.id}>
          <Link href={`/posts/${post.id}`}>{post.title}</Link>
        </li>
      ))}
    </ul>
  )
}
```

At build time, Pylon analyzes the component, sees that it reads `posts.id` and
`posts.title`, and generates exactly that query — nothing more.

:::generates
```tsx title="You write"
const data = useData()
return data.posts.map(p => (
  <Link href={`/posts/${p.id}`}>{p.title}</Link>
))
```

```graphql title="Pylon generates"
query {
  posts {
    id
    title
  }
}
```
:::

Add `post.author.name` to the markup and the query grows to match,
automatically.

## Enable it

usePages is a plugin. Register it in `pylon.config.ts`:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon/pages/plugin'

export default {
  plugins: [usePages()]
} satisfies PylonConfig
```

The runtime — `useData`, `Link`, `PageProps`, and the rest — imports from
`@getcronit/pylon/pages`. The plugin lives at `@getcronit/pylon/pages/plugin`.

:::tip[This site runs on usePages]
The page you're reading is markdown, served through a Pylon GraphQL resolver and
rendered by a usePages route — the backend and frontend sharing one type system.
:::

## How it compares

The usual way to build a typed frontend is a separate React app talking to your
API through Apollo or React Query, with hand-written queries (or codegen you run
and commit) and a second deployment to manage. usePages collapses that:

| | Typical SPA + client | usePages |
| --- | --- | --- |
| Where it runs | a separate app & deploy | your Pylon app |
| Data fetching | hand-written queries / codegen | generated from what you render |
| Type link to the API | via committed codegen | direct, always in sync |
| Server rendering | extra setup | built in |

Next: [Routing & Pages](/docs/frontend/routing), then
[Fetching Data with useData](/docs/frontend/use-data).
