---
title: usePages
description: A file-based, server-rendered React frontend that ships with your Pylon backend.
section: Frontend — usePages
order: 0
nav: Routing & pages
---

`usePages` is Pylon's frontend: a file-based React router, server-rendered and
hydrated, that runs in the same Pylon process as your API. Pages fetch data from
your own GraphQL schema with [`useData`](/docs/frontend/use-data), and the exact
query each page needs is computed at build time.

:::tip[This site runs on usePages]
The page you're reading is markdown, served through a Pylon resolver and rendered
by a usePages route — the backend and frontend sharing one type system.
:::

## Enable it

Add the plugin in `pylon.config.ts`:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {usePages} from '@getcronit/pylon-pages/plugin'

export default {
  plugins: [usePages()]
} satisfies PylonConfig
```

The runtime (`useData`, `Link`, `PageProps`) imports from `@getcronit/pylon-pages`;
the plugin lives at `@getcronit/pylon-pages/plugin`.

## File-based routing

Routes live in a `pages/` directory. The folder structure becomes the URL:

```
pages/
  layout.tsx          → wraps every route
  page.tsx            → /
  docs/
    layout.tsx        → wraps /docs/*
    [...slug]/
      page.tsx        → /docs/* (catch-all)
  posts/
    [id]/
      page.tsx        → /posts/:id
```

- `page.tsx` renders a route.
- `layout.tsx` wraps the routes in its directory and below.
- `[param]` is a dynamic segment; `[...slug]` is a catch-all.

## Layouts and pages

The root layout renders the HTML shell:

```tsx
// pages/layout.tsx
import '../globals.css'

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

A page receives typed route information via `PageProps`:

```tsx
// pages/posts/[id]/page.tsx
import {useData, type PageProps} from '@getcronit/pylon-pages'

export default function PostPage({params, searchParams, path}: PageProps) {
  const id = params.id as string
  const data = useData()
  const post = data.post({id})

  return (
    <article>
      <h1>{post?.title}</h1>
      <p>{post?.body}</p>
    </article>
  )
}
```

`PageProps` provides:

- `params` — route parameters (`[id]` → `params.id`; `[...slug]` →
  `params.slug` as a string array)
- `searchParams` — query-string parameters
- `path` — the current pathname
- `context` — request-derived data you inject server-side

## Navigation

Use `Link` for client-side navigation:

```tsx
import {Link} from '@getcronit/pylon-pages'

<Link href="/docs/getting-started">Get started</Link>
```

## How rendering works

On each request, Pylon matches the route, runs a server pass that resolves the
data each page needs, renders the HTML, and embeds a cache snapshot so the client
hydrates with zero extra round-trips. Read on for how data fetching works in
[useData](/docs/frontend/use-data), and how to style pages in
[Styling](/docs/frontend/styling).
