---
title: Loading & Errors
description: Handle not-found, unauthorized, and redirect cases — and let Pylon manage loading states for you.
section: Frontend — usePages
order: 3
nav: Loading & errors
---

usePages gives pages a small set of control-flow helpers for the common HTTP
outcomes, and handles loading states for you during server rendering and
navigation.

## Short-circuiting a render

Import these helpers from `@getcronit/pylon-pages` and call them anywhere in a
page (or a component it renders) to stop and produce the right response:

```tsx
import {notFound, unauthorized, forbidden, redirect, useData} from '@getcronit/pylon-pages'
import type {PageProps} from '@getcronit/pylon-pages'

export default function PostPage({params}: PageProps) {
  const id = params.id as string
  const data = useData()
  const post = data.post({id})

  if (!post) {
    notFound('No post with that id')
  }

  return <article>{post.title}</article>
}
```

| Helper | Result |
| --- | --- |
| `notFound(message?)` | a 404 response / not-found page |
| `unauthorized(message?)` | a 401 response |
| `forbidden(message?)` | a 403 response |
| `redirect(url, {status?})` | a redirect (302 by default) |

On the server these throw a real `Response` with the right status code; on the
client they drive navigation. Each accepts an optional message and, for the error
helpers, `returnText` / `returnUrl` to offer the user a way back:

```tsx
unauthorized('Please sign in', {returnText: 'Go to login', returnUrl: '/auth/login'})
redirect('/dashboard')
```

## Loading states

You don't wire up spinners for data fetching. usePages renders each route on the
server with its data already resolved, so the first paint is complete. During
client-side navigation and code-splitting, Pylon shows a fallback while the next
route loads. Data access through [`useData`](/docs/frontend/use-data) integrates
with React Suspense, so a page renders once its data is ready.

## Unexpected errors

Errors that aren't one of the cases above are caught by an error boundary around
each route, so a failure in one page doesn't take down the whole app. Use the
helpers above for expected outcomes, and let the boundary handle the unexpected.
