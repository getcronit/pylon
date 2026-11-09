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
import {redirect, useData, type PageProps} from '@getcronit/pylon/pages'

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

You populate it with `useRequestContext`, a config plugin that runs once per
request before the page renders:

```ts title="pylon.config.ts"
import {getCookie, useNodeServer, type PylonConfig} from '@getcronit/pylon'
import {usePages, useRequestContext} from '@getcronit/pylon/pages/plugin'

export default {
  plugins: [
    useRequestContext(
      c => ({
        theme: getCookie(c, 'theme') ?? 'system',
        sidebarOpen: getCookie(c, 'sidebar') !== 'closed'
      }),
      {vary: ['Cookie']}
    ),
    usePages(),
    useNodeServer()
  ]
} satisfies PylonConfig
```

The factory receives the Hono context, so it can read cookies, headers, the
principal — anything request-scoped. It may be async.

Order in `plugins` doesn't matter: `useRequestContext` runs in the `'first'`
phase and `usePages` in `'last'`, so the context is always populated before a
page reads it.

Cookie helpers come from `@getcronit/pylon` itself — `getCookie`, `setCookie`,
`deleteCookie`, and the signed pair `getSignedCookie` / `setSignedCookie`:

```ts
import {
  getCookie,
  setCookie,
  deleteCookie,
  getSignedCookie,
  setSignedCookie
} from '@getcronit/pylon'

// inside a route or middleware, where `c` is the Hono context
setCookie(c, 'theme', 'dark', {path: '/', maxAge: 31536000, sameSite: 'Lax'})
deleteCookie(c, 'theme', {path: '/'})

// signed cookies carry a tamper-evident signature
await setSignedCookie(c, 'session', value, process.env.COOKIE_SECRET!)
const session = await getSignedCookie(c, process.env.COOKIE_SECRET!, 'session')
```

Don't reach for `hono/cookie` — `hono` is pylon's dependency, not your app's, so
that import resolves only by accident under some package managers.

Pass `vary` for any header your factory reads. It appends to the response's
`Vary`, which is what keeps a CDN from serving one visitor's context to another.

### Typing it

`context` is `unknown` until you declare its shape:

```ts title="pylon.d.ts"
declare module '@getcronit/pylon' {
  interface Variables {
    pagesContext: {
      theme: 'light' | 'dark' | 'system'
      sidebarOpen: boolean
    }
  }
}
```

That type then flows into `PageProps['context']` and `useRouteData()`.

This pairs naturally with [pylon-auth](/docs/authentication/overview): the
principal and role resolved for the request flow into the context, so the
frontend reads the same identity the resolvers enforce.

## Layouts can read it too

Shared chrome often needs identity — a header that shows the signed-in user, a
nav that hides admin links. Read `context` in a layout exactly as in a page:

```tsx title="pages/layout.tsx"
import {Link, type LayoutProps} from '@getcronit/pylon/pages'

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
import {useRouteData} from '@getcronit/pylon/pages'

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

## Writing cookies from a render

`useResponseCookies` sets a cookie on the SSR response from inside a page or
layout — for persisting something the render just worked out:

```tsx title="pages/layout.tsx"
import {useResponseCookies, type LayoutProps} from '@getcronit/pylon/pages'

export default function RootLayout({children, context}: LayoutProps) {
  const cookies = useResponseCookies()

  if (!context.seen) {
    cookies.set('seen', '1', {path: '/', maxAge: 31536000})
  }

  return <html><body>{children}</body></html>
}
```

Cookies default to `SameSite=Lax`, and to `Secure` when the request arrived over
HTTPS. A response that sets one is marked `Cache-Control: private`, so a shared
cache can't hand it to someone else.

:::warning
Writes must be **idempotent**. This is a side effect during render, and React may
render a component more than once — the error path renders the tree twice. Setting
a cookie to a computed value is safe; incrementing a counter is not.

It is also the wrong tool for session or auth tokens: cookies written here are not
`HttpOnly` by default, because this API is for client-readable UI state like theme,
sidebar, or locale.
:::

In the browser the hook is a no-op that warns — there's no response to write to
once the page is interactive. Use `document.cookie`, or call a route.
