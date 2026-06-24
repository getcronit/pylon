---
title: Errors
nav: Errors
description: One structured error type for GraphQL and HTTP — thrown errors map cleanly to GraphQL and to HTTP status codes.
section: Core Concepts
order: 4
---

Errors in Pylon are values you throw, not envelopes you build. **`ServiceError` is
the canonical structured error** — throw it from a resolver and Pylon surfaces a
clean, coded GraphQL error; throw a status-bearing error from a route and Pylon
maps it to the right HTTP response.

## `ServiceError`

`ServiceError` carries a machine-readable code, an HTTP status, and optional
structured details alongside the message:

```ts
import {Pylon, ServiceError} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Query: {
      author: async (id: string): Promise<Author> => {
        const author = await Author.objects.find({id})
        if (!author) {
          throw new ServiceError('Author not found', {
            code: 'AUTHOR_NOT_FOUND',
            statusCode: 404,
            details: {id}
          })
        }
        return author
      }
    }
  }
})
```

The `code` and `details` travel in the GraphQL error's `extensions`, so clients can
branch on `code` instead of string-matching messages.

:::tip
For mutations with expected, user-facing validation failures, prefer the
[`mutation()` payload wrapper](/docs/core-concepts/resolvers#mutation-payloads) — a
thrown `ServiceError` is folded into `userErrors` instead of becoming a top-level
error.
:::

## Errors in HTTP routes

Plain Hono routes don't go through GraphQL, so Pylon gives them their own mapping.
`Pylon.onError` reads a thrown error's numeric `statusCode` and turns it into the
HTTP status. The `@getcronit/pylon-db` errors carry the right status out of the box:

| Thrown error | HTTP status |
| --- | --- |
| `ForbiddenError` | 403 |
| `FeatureDisabledError` | 403 |
| `NotFoundError` | 404 |
| any error with a numeric `statusCode` | that status |
| a Hono `HTTPException` | its own status |
| anything else | 500 |

So a route guard can simply throw and trust the status:

```ts
import {Pylon} from '@getcronit/pylon'
import {ForbiddenError} from '@getcronit/pylon-db'

const app = new Pylon({graphql: {Query: {ping: (): string => 'pong'}}})

app.get('/admin/report', async c => {
  const role = c.req.header('x-role')
  if (role !== 'admin') {
    throw new ForbiddenError('Admins only') // → 403, not a bare 500
  }
  return c.json({ok: true})
})

export default app
```

GraphQL errors never reach `onError` — Yoga maps those, including the
`extensions` from a `ServiceError`.

## Development vs production

In development (`NODE_ENV === 'development'`) errors are **unmasked**: messages and
stack details pass through so you can debug. In production, generic errors are
masked to avoid leaking internals — but a `ServiceError`'s message, `code`, and
`details` are intentional and always visible, which is why deliberate, recoverable
failures should be `ServiceError`s rather than raw `throw`s.
