---
title: Context
description: Access the request, headers, environment bindings, and per-request state from any resolver.
section: Core Concepts
order: 3
---

Pylon is built on [Hono](https://hono.dev). Inside any resolver you can reach the
current request context with `getContext()` — no need to thread it through your
function signatures.

```ts
import {Pylon, getContext} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Query: {
      whoAmI: () => {
        const c = getContext()
        const auth = c.req.header('authorization')
        return auth ? 'authenticated' : 'anonymous'
      }
    }
  }
})
```

The context is resolved through an `AsyncLocalStorage`, so it is always the right
one for the in-flight request.

## Reading the request

`getContext()` returns the Hono context. Common uses:

```ts
const c = getContext()

c.req.header('x-tenant-id') // a request header
c.req.query('page')         // a query-string parameter
c.req.path                  // the request path
c.env.DATABASE_URL          // an environment binding
```

## Bindings and variables

`c.env` holds **bindings** (environment variables, and platform resources like a
Cloudflare D1 database). `c.get(...)` / `c.set(...)` hold per-request
**variables**. You type both by augmenting the Pylon module in `pylon.d.ts`:

```ts
// pylon.d.ts
import '@getcronit/pylon'

declare module '@getcronit/pylon' {
  interface Bindings {
    DATABASE_URL: string
  }
  interface Variables {
    session: {userId: number}
  }
}
```

Now `c.env.DATABASE_URL` and `c.get('session')` are fully typed.

## Setting state in middleware

A common pattern is to populate a variable in middleware (for example, decoding a
session) and read it from resolvers. A `Pylon` instance extends Hono, so you can
add middleware directly on it:

```ts
import {Pylon, getContext} from '@getcronit/pylon'

const app = new Pylon({
  graphql: {
    Query: {
      me: () => getContext().get('session') ?? null
    }
  }
})

app.use(async (c, next) => {
  const token = c.req.header('authorization')
  c.set('session', token ? decode(token) : undefined)
  await next()
})

export default app
```

For reusable, ordered setup, prefer a **plugin** instead — plugins like
[`useIdentity`](/docs/authentication/overview) and
[`useDatabase`](/docs/data/policies) read context the same way to bind the
principal, tenant, and features for the request.
