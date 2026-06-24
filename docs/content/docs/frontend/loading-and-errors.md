---
title: Loading & Error States
nav: Loading & Errors
description: Suspense-driven loading, throwing control-flow helpers like notFound and redirect, and the error pages that render them.
section: Frontend — usePages
order: 6
---

usePages handles loading and errors with the React tools you already know —
Suspense for in-flight data, thrown values for HTTP control flow. A page reads
data optimistically; while that data resolves the route shows a fallback, and
when something is missing or denied you **throw** a helper that turns into the
right HTTP status and error page.

## Loading

`useData` suspends while its query is in flight. Each route is wrapped in a
Suspense boundary with a `HydrateFallback`, so a page that's still fetching shows
the fallback instead of a blank frame — no loading flag to thread through your
component:

```tsx title="pages/posts/page.tsx"
import {useData} from '@getcronit/pylon-pages'

export default function Posts() {
  const data = useData() // suspends until resolved
  return <ul>{data.posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
}
```

During SSR the server awaits the data before sending HTML, so the first paint is
already populated. On the client, the fallback covers navigations that need
fresh data.

## Control-flow helpers

These functions **throw** — they never return, so call them inline and let them
unwind the render. All import from `@getcronit/pylon-pages`:

| Helper | Status | Use it when |
| --- | --- | --- |
| `notFound(message?)` | 404 | the requested entity doesn't exist |
| `forbidden(message?)` | 403 | the user is signed in but not allowed |
| `unauthorized(message?)` | 401 | the user must sign in |
| `redirect(url, {status?})` | 302 (default) | the route should bounce elsewhere |

```tsx title="pages/posts/[id]/page.tsx"
import {notFound, useData, type PageProps} from '@getcronit/pylon-pages'

export default function PostPage({params}: PageProps) {
  const id = params.id as string
  const data = useData()
  const post = data.post({id})

  if (!post) notFound('No post with that id')

  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </article>
  )
}
```

On the server these throw a real `Response` with the right status; in the
browser they unwind the render and show the matching error element. `redirect`
navigates client-side when it can, and emits a `Location` response on the
server:

```tsx
import {redirect} from '@getcronit/pylon-pages'

if (!data.session) redirect('/login', {status: 303})
```

## Error pages

When a route throws, usePages renders an error element:

- **`StatusPage`** handles HTTP errors — the 404/403/401 from the helpers above,
  with the message you passed and a return link.
- **`GlobalErrorPage`** is the catch-all for unexpected (500-class) errors.

Both are wired in automatically per route, and both are exported from
`@getcronit/pylon-pages` if you want to render or theme them yourself:

```tsx
import {StatusPage, GlobalErrorPage} from '@getcronit/pylon-pages'
```

:::tip
Prefer the helpers to ad-hoc conditionals. `if (!post) notFound()` reads clearly,
returns the correct status to crawlers and clients, and renders a consistent
error page — all from one line.
:::

:::note
Because the helpers throw, code after them never runs. TypeScript narrows on the
`never` return, so after `if (!post) notFound()` the compiler knows `post` is
non-null below.
:::
