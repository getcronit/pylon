---
title: Loading & Error States
nav: Loading & Errors
description: Suspense-driven loading with streaming SSR and loading.tsx fallbacks, throwing control-flow helpers like notFound and redirect, custom error.tsx / not-found.tsx pages that cascade, and an ErrorBoundary for in-page failures.
section: Frontend — usePages
order: 6
---

usePages handles loading and errors with the React tools you already know —
Suspense for in-flight data, thrown values for HTTP control flow. A page reads
data optimistically; while that data resolves the route shows a fallback, and
when something is missing or denied you **throw** a helper that turns into the
right HTTP status and error page.

## Loading

`useData` suspends while its query is in flight — no loading flag to thread
through your component:

```tsx title="pages/posts/page.tsx"
import {useData} from '@getcronit/pylon/pages'

export default function Posts() {
  const data = useData() // suspends until resolved
  return <ul>{data.posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
}
```

### Streaming SSR

The server **streams**: it sends the surrounding shell as soon as it's ready and
streams each Suspense boundary in as its data resolves. So a slow segment no
longer blocks first paint — the chrome shows immediately, with the segment's
fallback in its place, and the real content swaps in when it arrives.

A boundary comes from a `loading.tsx` (below) or your own `<Suspense>`. **With no
boundary in a route's chain, there's nothing to stream** — the server simply
includes the resolved content in the shell, so the first paint is fully populated,
exactly as a buffered render would be. You opt into streaming a segment by giving
it a fallback; you never opt out of anything.

### Custom loading UI — `loading.tsx`

Drop a `loading.tsx` beside a `layout.tsx`/`page.tsx` to give that segment a
Suspense fallback. It is the **default export** and takes no props:

```tsx title="pages/posts/loading.tsx"
export default function PostsLoading() {
  return <p>Loading posts…</p>
}
```

`loading.tsx` **cascades** like `error.tsx`/`not-found.tsx`: it covers its own
segment and every nested route that doesn't define its own. It's also the route's
`HydrateFallback` (shown during client-side navigation to the segment). Without
one, a built-in fallback is used.

```
pages/
  layout.tsx
  page.tsx
  posts/
    loading.tsx       → fallback for /posts and below (streamed in the shell)
    page.tsx
    [id]/
      page.tsx        → inherits posts/loading.tsx
```

For a per-widget loading state rather than a whole segment, drop a `<Suspense>`
right where you need it — it streams the same way:

```tsx
import {Suspense} from 'react'

<Suspense fallback={<Spinner />}>
  <SlowWidget />
</Suspense>
```

:::warning
A `notFound()`/`redirect()`/`forbidden()` thrown **below a boundary** — from a
component whose data was still resolving when the shell was sent — can render the
right UI but **cannot change the HTTP status**: the response (a 200) is already on
the wire. Above any boundary, or with no `loading.tsx` in the chain, the status is
always correct. So for a route whose *existence* depends on data (a `notFound()`
that must return a real 404 to crawlers), either don't wrap that segment in a
`loading.tsx`, or resolve the check before the boundary. This is the one trade-off
streaming makes; it's scoped entirely to segments you gave a fallback.
:::

## Control-flow helpers

These functions **throw** — they never return, so call them inline and let them
unwind the render. All import from `@getcronit/pylon/pages`:

| Helper | Status | Use it when |
| --- | --- | --- |
| `notFound(message?)` | 404 | the requested entity doesn't exist |
| `forbidden(message?)` | 403 | the user is signed in but not allowed |
| `unauthorized(message?)` | 401 | the user must sign in |
| `redirect(url, {status?})` | 302 (default) | the route should bounce elsewhere |

```tsx title="pages/posts/[id]/page.tsx"
import {notFound, useData, type PageProps} from '@getcronit/pylon/pages'

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

:::note
One exception: a helper thrown **below a streamed boundary** (a `loading.tsx` or
`<Suspense>`) can't set the status once the shell has been sent — see the
streaming warning under **Loading** above.
:::


```tsx
import {redirect} from '@getcronit/pylon/pages'

if (!data.session) redirect('/login', {status: 303})
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

## Error pages

When a route throws, usePages renders an error element. Two are wired in
automatically for every route:

- **`StatusPage`** handles HTTP errors — the 404/403/401 from the helpers above,
  with the message you passed and a return link.
- **`GlobalErrorPage`** is the catch-all for unexpected (500-class) errors.

Both are exported from `@getcronit/pylon/pages` if you want to render or theme
them yourself:

```tsx
import {StatusPage, GlobalErrorPage} from '@getcronit/pylon/pages'
```

### Custom error UI — `error.tsx`

Drop an `error.tsx` beside a `layout.tsx`/`page.tsx` to replace the error page
for that segment. It is the **default export** and receives the caught `error`
plus a `reset` to retry:

```tsx title="pages/dashboard/error.tsx"
export default function DashboardError({
  error,
  reset
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div>
      <p>Something went wrong: {error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

`error.tsx` **cascades**: it covers its own segment and every nested route that
doesn't define its own. Put one at the root and the whole app inherits it;
override deeper by adding another `error.tsx`. When a route fails, only that
segment is swapped for its error UI — the surrounding layouts keep rendering,
server-side, with the right status.

```
pages/
  error.tsx           → app-wide error UI (covers every route)
  layout.tsx
  page.tsx
  dashboard/
    error.tsx         → overrides for /dashboard and below
    page.tsx
```

:::warning
Without a root `pages/error.tsx`, uncaught render errors fall back to the
built-in `GlobalErrorPage` — and since a missing boundary isn't a build error,
that fallback reappears silently. Pylon **warns at build** when the root
`error.tsx` is absent. Add one to make it a decision, not an accident.
:::

### Custom 404 — `not-found.tsx`

`not-found.tsx` does the same for 404s. It replaces `StatusPage` for unmatched
paths and for `notFound()` throws in that segment, and it cascades identically —
a root `pages/not-found.tsx` is your app-wide 404. It takes no props:

```tsx title="pages/not-found.tsx"
import {Link} from '@getcronit/pylon/pages'

export default function NotFound() {
  return (
    <div>
      <h1>Page not found</h1>
      <Link href="/">Go home</Link>
    </div>
  )
}
```

The response still carries the `404` status — only the UI changes.

### Containing failures inside a page — `<ErrorBoundary>`

`error.tsx` works at the **route segment** level. To isolate a single **widget**
so one failing panel doesn't take the whole route down, wrap it in
`<ErrorBoundary>`:

```tsx title="pages/dashboard/page.tsx"
import {ErrorBoundary} from '@getcronit/pylon/pages'

export default function Dashboard() {
  return (
    <main>
      <Header />
      <ErrorBoundary
        fallback={({error, reset}) => (
          <RevenueError message={error.message} onRetry={reset} />
        )}>
        <RevenueWidget />
      </ErrorBoundary>
    </main>
  )
}
```

A healthy widget still renders **inline on the server**. If its read fails on
the server, the failure escalates to the route's `error.tsx` (server-rendered);
on the client, the boundary catches it and renders `fallback`. Want a per-widget
loading state instead of blocking on the read? Add your own `<Suspense>` inside
— it composes:

```tsx
<ErrorBoundary fallback={({error}) => <Failed message={error.message} />}>
  <Suspense fallback={<Spinner />}>
    <SlowWidget />
  </Suspense>
</ErrorBoundary>
```
