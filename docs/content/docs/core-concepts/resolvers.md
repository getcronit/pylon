---
title: Resolvers
description: Queries, mutations, arguments, and return types — how plain functions become GraphQL operations.
section: Core Concepts
order: 1
---

A Pylon app is a `Pylon` instance you export from `src/index.ts`. The `graphql`
you pass it has `Query`, `Mutation`, and `Subscription` members — plain functions
whose TypeScript signatures Pylon reads to build the schema.

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

Function parameters become GraphQL arguments, matched by name. An object
parameter becomes an input type:

```ts
new Pylon({
  graphql: {
    Query: {
      // product(id: String!)
      product: (id: string): Product | null => null,

      // products(filter: ProductsFilterInput!)
      products: (filter: {tag?: string; limit?: number}): Product[] => []
    },
    Mutation: {
      // addComment(postId: String!, input: AddCommentInput!)
      addComment: (postId: string, input: {body: string}): Comment => ({}) as Comment
    }
  }
})
```

## Return types

Return types map directly to GraphQL:

| TypeScript | GraphQL |
| --- | --- |
| `string` | `String!` |
| `number` | `Float!` (or `Int!` where inferable) |
| `boolean` | `Boolean!` |
| `Date` | `Date` scalar |
| `T \| null` | nullable `T` |
| `T[]` | `[T!]!` |
| `Promise<T>` | resolves to `T` |
| a class | a GraphQL object type |

Async resolvers are fully supported — return a `Promise` and Pylon awaits it:

```ts
new Pylon({
  graphql: {
    Query: {
      feed: async (): Promise<Post[]> => Post.objects.all()
    }
  }
})
```

## Methods as fields

A class method becomes a field on its type, with the method's parameters as
arguments. This lets a type compute derived data:

```ts
class Author {
  id!: string
  name!: string

  // becomes a field: displayName: String!
  displayName(): string {
    return this.name.toUpperCase()
  }
}
```

## Composing apps

Each feature can be its own `Pylon` instance with its own `graphql`. The root
composes them into one merged schema (and mounts their routes) with `compose` —
the foundation of [apps](/docs/apps/overview):

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {blog} from './apps/blog'
import {shop} from './apps/shop'

export default new Pylon().compose(blog, shop)
```
