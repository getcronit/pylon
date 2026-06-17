---
title: Errors & Mutations
description: Structured errors and Shopify-style mutation payloads with typed userErrors.
section: Core Concepts
order: 4
---

Pylon distinguishes two kinds of failure: **unexpected errors** (bugs, outages)
that should surface as GraphQL errors, and **expected errors** (validation, a
business rule) that the client should handle as data.

## ServiceError

Throw a `ServiceError` for a deliberate, coded failure. It carries a machine
`code`, an HTTP `statusCode`, and optional `details`:

```ts
import {Pylon, ServiceError} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Mutation: {
      reserve: (sku: string) => {
        if (isSoldOut(sku)) {
          throw new ServiceError('Item is sold out', {
            code: 'SOLD_OUT',
            statusCode: 409,
            details: {sku}
          })
        }
        // ...
      }
    }
  }
})
```

The code and details are exposed in the GraphQL error's `extensions`, so clients
can branch on `code` instead of parsing messages.

## Mutation payloads

Wrap a mutation with `mutation()` to turn expected errors into a typed
`userErrors` array — the [Shopify](https://shopify.dev) convention — instead of a
thrown GraphQL error. On success the wrapper adds an empty `userErrors: []`:

```ts
import {Pylon, mutation, ServiceError} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Mutation: {
      productCreate: mutation(async (input: {name: string; sku: string}) => {
        // a thrown ValidationError or ServiceError becomes a userError
        const product = await Product.objects.create(input)
        return {product}
      })
    }
  }
})
```

The generated payload looks like:

```graphql
type ProductCreatePayload {
  product: Product
  userErrors: [UserError!]!
}

type UserError {
  field: [String!]!
  message: String!
  code: String!
}
```

- On success: `{ product, userErrors: [] }`
- On a handled error: `{ userErrors: [{ field: ['sku'], message: '…', code: 'SKU_TAKEN' }] }`

This makes form-style mutations easy to consume: the client always gets a payload
and reads `userErrors` to show field-level messages.

## ORM errors

The [`useDatabase`](/docs/data/policies) plugin maps ORM errors to client-safe
GraphQL errors automatically:

- `ValidationError` → `BAD_USER_INPUT`, with the structured field issues
- `ForbiddenError` → `FORBIDDEN`
- `NotFoundError` → `NOT_FOUND`

Inside a `mutation()` wrapper, a `ValidationError`'s issues are surfaced as
`userErrors` with their `field` paths and `code`s — so model validation flows
straight through to the client with no extra wiring.
