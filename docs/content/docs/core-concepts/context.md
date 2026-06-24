---
title: Context & Environment
nav: Context
description: Read the per-request Hono context and environment from anywhere in a resolver — no prop drilling.
section: Core Concepts
order: 3
---

A resolver often needs the incoming request: a header, a cookie, the authenticated
caller. Pylon makes that available from anywhere in your call stack without
threading a `ctx` parameter through every function. **`getContext()` reads the
current request's context directly.**

## Reading the request

`getContext()` returns the per-request Hono `Context`, resolved through
`AsyncLocalStorage`. Call it inside any resolver — or any function a resolver calls
— and you get the live request:

```ts
import {Pylon, getContext} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Query: {
      whoAmI: (): string => {
        const c = getContext()
        const auth = c.req.header('authorization') ?? 'anonymous'
        return auth
      }
    }
  }
})
```

Because the context lives in async-local storage, it is bound to the request that
is executing — concurrent requests never see each other's context.

:::warning
`getContext()` throws if there is no active request context. Call it from within a
resolver, route handler, or plugin middleware — never at module top level or during
build.
:::

## Reading the environment

`getEnv()` returns the environment values for the current request. It reads from the
context's env first and falls back to `process.env`, so the same call works across
runtimes:

```ts
import {Pylon, getEnv} from '@getcronit/pylon'

new Pylon({
  graphql: {
    Query: {
      region: (): string => getEnv().AWS_REGION ?? 'local'
    }
  }
})
```

## Writing to the context

Plugins and middleware can attach values for downstream resolvers with
`setContext()`. This is how the framework's batteries publish things like the
authenticated principal:

```ts
import {setContext} from '@getcronit/pylon'

// inside plugin middleware
setContext(c => {
  c.set('requestId', crypto.randomUUID())
  return c
})
```

## Typing the context

The context is typed by `Context`, `Env`, `Bindings`, and `Variables`, all exported
from the package entry point. `Variables` are the values set on `c` (`c.get` /
`c.set`); `Bindings` are runtime-provided values. Augment them to make custom keys
type-safe end to end:

```ts
import type {Context, Variables} from '@getcronit/pylon'

declare module '@getcronit/pylon' {
  interface Variables {
    requestId: string
  }
}

// now c.get('requestId') is typed string
```

For the authenticated caller specifically, reach for the helpers in
[Authentication](/docs/authentication/overview) rather than reading the context by
hand.
