---
title: Type-Driven Schema
description: How Pylon turns TypeScript types into a GraphQL schema — classes, unions, interfaces, and arguments.
section: Core Concepts
order: 0
---

Pylon's compiler reads the TypeScript types of your `graphql` resolvers and
derives a GraphQL schema from them. You never write SDL — the schema is a fact
about your code.

## Objects from classes

A class becomes a GraphQL object type. Public fields become GraphQL fields, with
nullability inferred straight from the type.

:::generates
```ts title="You write"
class Product {
  id!: string
  name!: string
  price!: number
  description!: string | null
}
```

```graphql title="Pylon generates"
type Product {
  id: String!
  name: String!
  price: Float!
  description: String
}
```
:::

## Arguments from parameters

Function parameters become field arguments, matched by name. An object parameter
becomes an input type.

:::generates
```ts title="You write"
new Pylon({
  graphql: {
    Query: {
      product: (id: string): Product | null => null,
      products: (filter: {tag?: string; limit?: number}): Product[] => []
    }
  }
})
```

```graphql title="Pylon generates"
type Query {
  product(id: String!): Product
  products(filter: ProductsFilterInput!): [Product!]!
}
```
:::

## Lists, async, and scalars

Every TypeScript shape maps to a GraphQL type, with list nesting and nullability
preserved exactly:

| TypeScript | GraphQL |
| --- | --- |
| `string` | `String!` |
| `number` | `Float!` |
| `boolean` | `Boolean!` |
| `T \| null` | nullable `T` |
| `T[]` | `[T!]!` |
| `T[][]` | `[[T!]!]!` |
| `Promise<T>` | `T` (resolved) |
| `Date` | `Date` scalar |

:::tip
A string-literal union like `'ADMIN' | 'READER'` becomes a GraphQL **enum**, and
class inheritance becomes a GraphQL **interface** — see
[Interfaces & Unions](/docs/core-concepts/interfaces-unions).
:::

Because the schema is derived from your types, it can never drift from your
implementation — a rename is just a TypeScript rename, and a breaking change is a
type error at build time. Read [How Pylon Works](/docs/how-pylon-works) for the
full pipeline.
