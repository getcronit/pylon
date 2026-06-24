---
title: Server Context
nav: Server Context
description: PageProps.context carries auth, role, and feature data from the SSR prepass — hydrated to the client so every page branches on it.
section: Frontend — usePages
order: 7
---

Every page and layout receives a `context` on its props. It carries
request-derived data resolved during the **SSR prepass** — typically the
authenticated user, their role, and which features are enabled — so a page can
branch on auth without making its own round-trip. The context is serialized into
the page and rehydrated on the client, so the same `context` is available on both
sides of the render.

## Reading context

`context` is part of `PageProps` and `LayoutProps`:

```tsx title="pages/account/page.tsx"
import {redirect, useData, type PageProps} from '@getcronit/pylon-pages'

export default function Account({context}: PageProps) {
  if (!context.user) redirect('/login')

  const data = useData()

  return (
    <div>
      <h1>Welcome, {context.user.name}</h1>
      {context.role === 'admin' && <a href="/admin">Admin panel</a>}
    </div>
  )
}
```

Because `context` is resolved before the page renders, you can guard a route
with a [control-flow helper](/docs/frontend/loading-and-errors) — `redirect`,
`unauthorized`, `forbidden` — at the top of the component, before any data is
read.

## Where context comes from

The shape of `context` is yours to define — the prepass runs server-side with
access to the request, your auth, and your features, and produces the object
that lands on `PageProps.context`. A common shape:

```ts
context: {
  user: {id: string; name: string} | null
  role: 'guest' | 'member' | 'admin'
  features: Record<string, boolean>
}
```

This pairs naturally with [pylon-auth](/docs/authentication/overview): the
principal and role resolved for the request flow into the context, so the
frontend reads the same identity the resolvers enforce.

## Layouts can read it too

Shared chrome often needs identity — a header that shows the signed-in user, a
nav that hides admin links. Read `context` in a layout exactly as in a page:

```tsx title="pages/layout.tsx"
import {Link, type LayoutProps} from '@getcronit/pylon-pages'

export default function RootLayout({children, context}: LayoutProps) {
  return (
    <html lang="en">
      <body>
        <header>
          {context.user ? (
            <span>{context.user.name}</span>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </header>
        {children}
      </body>
    </html>
  )
}
```

## useRouteData

`useRouteData()` reads the route's hydrated data from inside a component without
threading it through props — handy in a deeply nested component that needs what
the route already resolved:

```tsx
import {useRouteData} from '@getcronit/pylon-pages'

function ActiveUser() {
  const route = useRouteData()
  return <span>{route.context.user?.name}</span>
}
```

:::note
`context` is the same object on the server and the client — it's part of the
hydration payload. Don't put secrets in it: anything in `context` ships to the
browser. Keep server-only values out of the context and behind resolvers.
:::
