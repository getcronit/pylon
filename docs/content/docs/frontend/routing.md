---
title: Routing & Pages
nav: Routing & Pages
description: File-based routing — folders become URL segments, dynamic params, catch-alls, and nested layouts that wrap their subtree.
section: Frontend — usePages
order: 1
---

Routes live in a `pages/` directory. The folder structure **is** the URL map:
every `page.tsx` renders a route, every `layout.tsx` wraps the routes in its
directory and below. There is no router config to write — the file tree is the
source of truth.

## The file tree

```
pages/
  layout.tsx          → root layout, wraps every route
  page.tsx            → /
  about/
    page.tsx          → /about
  posts/
    page.tsx          → /posts
    [id]/
      page.tsx        → /posts/:id
  docs/
    layout.tsx        → wraps /docs/*
    [...slug]/
      page.tsx        → /docs/* (catch-all)
```

The mapping rules:

- A directory name becomes a static path segment (`about/` → `/about`).
- `page.tsx` renders the route for its directory.
- `[param]/` is a **dynamic segment**: `[id]` → `:id`, available as
  `params.id` (a `string`).
- `[...slug]/` is a **catch-all**: it matches the rest of the path and gives you
  `params.slug` as a `string[]`.
- `layout.tsx` wraps every route in its directory and all nested directories.

## Pages

A page is the **default export** of `page.tsx`. It receives a typed
`PageProps`:

```tsx title="pages/posts/[id]/page.tsx"
import {useData, type PageProps} from '@getcronit/pylon/pages'

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

### PageProps

Every page receives the same shape:

```ts
type PageProps = {
  context: /* server-injected request data — see /docs/frontend/server-context */
  params: Record<string, string | string[] | undefined>
  searchParams: Record<string, string>
  path: string
}
```

- `params` — route parameters. A `[id]` segment is a `string`; a `[...slug]`
  catch-all is a `string[]`. Narrow with `as string` / `as string[]` at the
  read site.
- `searchParams` — the parsed query string, e.g. `?page=2` → `{page: '2'}`.
- `path` — the current pathname.
- `context` — request-derived data (auth, role, features) resolved during the
  SSR prepass. See [Server Context](/docs/frontend/server-context).

:::note
`params` values are always strings — `[id]` for `/posts/42` gives you `"42"`,
not `42`. Coerce when you need a number, and pass the value straight into a
field argument like `data.post({id})`.
:::

## Catch-all routes

A `[...slug]` directory matches any remaining path depth and hands you the
segments as an array. This is how a single route renders an entire content tree
— the way this docs site serves every page from one route:

```tsx title="pages/docs/[...slug]/page.tsx"
import {notFound, useData, type PageProps} from '@getcronit/pylon/pages'

export default function DocPage({params}: PageProps) {
  const slug = (params.slug as string[]).join('/')
  const data = useData()
  const page = data.docPage({slug})

  if (!page) notFound()

  return <article dangerouslySetInnerHTML={{__html: page.html}} />
}
```

## Layouts

`layout.tsx` wraps its subtree and renders `children`. The **root layout**
(`pages/layout.tsx`) renders the HTML shell:

```tsx title="pages/layout.tsx"
import type {LayoutProps} from '@getcronit/pylon/pages'
import '../globals.css'

export default function RootLayout({children}: LayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

`LayoutProps` is `PageProps` plus `children`. Nested layouts add shared chrome
to a section — see [Layouts](/docs/frontend/layouts) for the full picture.

## How rendering works

On each request, Pylon matches the route, runs a server pass that resolves the
data the page needs, renders the HTML, and embeds a cache snapshot so the client
hydrates with no extra round-trips. The mechanism behind that data pass is
[useData](/docs/frontend/use-data).
