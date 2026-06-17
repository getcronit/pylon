---
title: Server Context
description: Pass request-derived data — the session, locale, feature flags — from the server into every page.
section: Frontend — usePages
order: 4
nav: Server context
---

Some data belongs to the request itself rather than to your GraphQL schema: the
signed-in user, the locale, a feature flag, an A/B bucket. usePages gives every
page a `context` prop, populated on the server, for exactly this.

## Injecting context

Set `pagesContext` from Hono middleware, deriving it from the request. It's
serialized into the page and made available to every route:

```ts
import {app, getContext} from '@getcronit/pylon'

app.use(async (c, next) => {
  const session = await readSession(c)
  c.set('pagesContext', {
    user: session?.user ?? null,
    locale: c.req.header('accept-language')?.split(',')[0] ?? 'en'
  })
  await next()
})
```

## Reading it in a page

The value arrives as `PageProps.context`:

```tsx
import {type PageProps} from '@getcronit/pylon-pages'

export default function Home({context}: PageProps) {
  return (
    <header>
      {context.user ? `Welcome, ${context.user.name}` : <a href="/auth/login">Sign in</a>}
    </header>
  )
}
```

Type the context by augmenting the module in `pylon.d.ts` so `context` is fully
typed across your pages.

## Context vs. useData

Use the right tool for the data:

- **`context`** — request-scoped facts the server already knows (session, locale,
  flags). No query, available everywhere, set once per request.
- **[`useData`](/docs/frontend/use-data)** — data from your GraphQL schema,
  fetched per page based on what you render.

Together they cover both halves: who's asking (context) and what they're looking
at (useData).
