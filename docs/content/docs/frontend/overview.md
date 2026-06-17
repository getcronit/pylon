---
title: Overview
description: A React frontend that lives in your Pylon app and is type-connected to your API — with the data query for every page generated at build time.
section: Frontend — usePages
order: -1
nav: Why usePages
---

`usePages` is the other half of Pylon's single-source-of-truth story. It's a
server-rendered React frontend that runs **inside your Pylon app**, reads from
**your** GraphQL schema with full type-safety, and — uniquely — generates the
exact data query for **every page at build time**.

If the [type-introspection compiler](/docs/how-pylon-works) connects your
TypeScript to your API and your database, usePages extends that same connection
all the way to the screen.

## The pitch

- **One app, one deploy, one type system.** Your API and your frontend are the
  same project. There's no separate client app, no CORS, no API base URL to
  configure, no second deployment. Rename a field in a resolver and the page that
  uses it fails to type-check.
- **You don't write queries.** You read fields off a typed proxy; Pylon's build
  step sees exactly what each page renders and generates the minimal GraphQL
  query for it. No documents to write, no fragments to maintain, no over- or
  under-fetching.
- **Server-rendered, instantly hydrated.** Each request renders on the server
  with its data already resolved, and the result is serialized into the page so
  the client hydrates with zero extra round-trips.
- **Familiar and minimal.** File-based routing, layouts, and `<Link>` — the
  conventions you already know — plus first-class [Tailwind CSS v4](/docs/frontend/styling).
- **Runs anywhere Pylon runs.** Node, Bun, Deno, and Cloudflare Workers.

## What it looks like

A page reads data with [`useData`](/docs/frontend/use-data). You never write a
query string — you just use the fields:

```tsx
import {Link, useData, type PageProps} from '@getcronit/pylon-pages'

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

At build time, Pylon analyzes this component, sees that it reads `posts.id` and
`posts.title`, and generates exactly `{ posts { id title } }` — nothing more.
Add `post.author.name` to the markup and the query grows to match, automatically.

## How it compares

The usual way to build a typed frontend is a separate React app talking to your
API through Apollo or React Query, with hand-written queries (or codegen you run
and commit) and a second deployment to manage. usePages collapses that:

| | Typical SPA + client | usePages |
| --- | --- | --- |
| Where it runs | a separate app & deploy | your Pylon app |
| Data fetching | hand-written queries / codegen | generated from what you render |
| Type connection to the API | via committed codegen | direct, always in sync |
| Server rendering | extra setup | built in |

## This site

The site you're reading is a usePages app. Its pages are markdown, served through
a Pylon GraphQL resolver and rendered by a usePages route — a small but real
example of the backend and frontend sharing one type system.

Next: [Routing & pages](/docs/frontend/use-pages),
[Data fetching](/docs/frontend/use-data), and [Styling](/docs/frontend/styling).
