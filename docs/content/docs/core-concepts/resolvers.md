---
title: Resolvers
nav: Resolvers
description: Plain functions become GraphQL operations — positional args become arguments, return types become fields.
section: Core Concepts
order: 1
---

A resolver in Pylon is a plain TypeScript function. You group them under `Query`,
`Mutation`, and `Subscription` inside the `graphql` you hand to `new Pylon(...)`,
and the compiler reads each function's signature to build the schema. **No
boilerplate sits between your function and its GraphQL field.**

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'

class Product {
  id!: string
  name!: string
  price!: number
}

export default new Pylon({
  graphql: {
    Query: {
      product: (id: string): Product | null => null,
      products: (): Product[] => []
    },
    Mutation: {
      createProduct: (name: string, price: number): Product => ({id: '1', name, price})
    }
  }
})
```

## Arguments

Positional parameters become GraphQL arguments, matched by name. An object
parameter becomes a generated input type:

```ts
new Pylon({
  graphql: {
    Query: {
      // product(id: String!)
      product: (id: string): Product | null => null,

      // products(filter: ProductsFilterInput!)
      products: (filter: {tag?: string; limit?: number}): Product[] => []
    }
  }
})
```

An optional parameter (`limit?: number`) becomes a nullable argument; a default
value keeps the argument optional too.

## Return types

Return types map directly to GraphQL, with nullability and list nesting preserved
exactly. Async resolvers are first-class — return a `Promise` and Pylon awaits it:

```ts
import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon-db'

export class Author extends models.Model {
  static objects = db.manager(Author)
  id = models.ID()
  name = models.Text({min: 2})
}

export default new Pylon({
  db: {models: [Author]},
  graphql: {
    Query: {
      authors: (): Promise<Author[]> => Author.objects.all()
    },
    Mutation: {
      createAuthor: (name: string): Promise<Author> => Author.objects.create({name})
    }
  }
})
```

## Reading the GraphQL request

Inside any resolver, `getResolveInfo()` exposes the live execution context. It
returns `{info, selectedFields}` — the raw GraphQL `info` object and a convenient
map of the fields the client actually asked for, which you can use to fetch only
what's needed:

```ts
import {Pylon, getResolveInfo} from '@getcronit/pylon'

new Pylon({
  graphql: {
    Query: {
      author: (id: string): Promise<Author> => {
        const {selectedFields} = getResolveInfo()
        // e.g. skip an expensive join when `posts` wasn't selected
        return Author.objects.get({id})
      }
    }
  }
})
```

## Mutation payloads

A mutation that can fail with expected, user-facing errors should return a
structured payload rather than throwing. Wrap the resolver in `mutation(fn)` and
Pylon gives you the Shopify-style shape: on success the field resolves to
`{entity, userErrors: []}`; when the function throws a `ServiceError` or a
validation error, it resolves to `{entity: null, userErrors: [...]}` instead of
surfacing a top-level GraphQL error.

```ts
import {Pylon, mutation, ServiceError} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Mutation: {
      createAuthor: mutation(async (name: string) => {
        if (name.length < 2) {
          throw new ServiceError('Name is too short', {
            code: 'NAME_TOO_SHORT',
            statusCode: 422,
            details: {field: 'name'}
          })
        }
        return Author.objects.create({name})
      })
    }
  }
})
```

```graphql title="The generated payload"
type CreateAuthorPayload {
  entity: Author
  userErrors: [UserError!]!
}
```

This keeps recoverable, field-level problems inside the typed response while real
faults still propagate as GraphQL errors. See [Errors](/docs/core-concepts/errors)
for `ServiceError` and route-level error mapping.

## Composing apps

Each feature can be its own `Pylon` instance with its own `graphql`. The root
merges them into one schema with `compose` — the foundation of
[apps](/docs/apps/overview):

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {blog} from './apps/blog'
import {shop} from './apps/shop'

export default new Pylon().compose(blog, shop)
```
