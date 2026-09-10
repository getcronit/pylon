---
title: Type-Driven Schema
nav: Type-Driven Schema
description: Your TypeScript types are the GraphQL schema — Pylon's compiler derives the SDL from the code you already wrote.
section: Core Concepts
order: 0
---

Most backends make you describe your data twice: once in a schema language, then
again in the resolvers that satisfy it. Every duplicated line is a chance for the
two to drift. Pylon removes the duplication entirely. **You never write SDL — the
return types and argument types of your resolvers _are_ the schema.**

## The schema is a fact about your code

Pylon exports one entry: a default `Pylon` instance. Its `graphql` property carries
your `Query`, `Mutation`, and `Subscription` resolvers. At build time the compiler
introspects the TypeScript type of that default export's `.graphql` property and
derives a GraphQL schema from it — no decorators, no SDL, no codegen step you run by
hand.

:::generates
```ts title="You write"
import {Pylon} from '@getcronit/pylon'

class Product {
  id!: string
  name!: string
  price!: number
  description!: string | null
}

export default new Pylon({
  graphql: {
    Query: {
      product: (id: string): Product | null => null
    }
  }
})
```

```graphql title="Pylon generates"
type Product {
  id: String!
  name: String!
  price: Float!
  description: String
}

type Query {
  product(id: String!): Product
}
```
:::

## Nullability is significant

The difference between `T` and `T | null` is the difference between a `T!` and a
`T` field. Pylon reads it straight from the type — there is no second place to
declare it, so a non-null field can never lie.

| TypeScript | GraphQL |
| --- | --- |
| `string` | `String!` |
| `number` | `Float!` |
| `boolean` | `Boolean!` |
| `T \| null` | nullable `T` |
| `T[]` | `[T!]!` |
| `T[][]` | `[[T!]!]!` |
| `Promise<T>` | `T` (awaited) |

A nullable element inside a list is just as precise — `(T | null)[]` becomes
`[T]!`, and `T[] | null` becomes `[T!]`.

## Built-in scalars

Pylon ships scalars for the shapes plain TypeScript can't express on its own.
Use them as ordinary types — the compiler maps each to its GraphQL scalar.

| Type | GraphQL scalar | Use for |
| --- | --- | --- |
| `Date` | `Date` | timestamps, serialized as ISO-8601 |
| any plain object/array shape | `JSON` | arbitrary JSON values |
| `Record<string, …>` | `JSONObject` | JSON objects |
| `void` | `Void` | mutations with no meaningful return |

```ts
class Event {
  id!: string
  occurredAt!: Date
  payload!: JSON
}
```

For numeric and identity precision, import the branded scalars from the package
entry point. `Int` and `Float` disambiguate a `number`, and `ID` marks a field as
a GraphQL `ID!` rather than a `String!`:

```ts
import {Pylon, type ID, type Int, type Float} from '@getcronit/pylon'

class LineItem {
  id!: ID
  quantity!: Int
  unitPrice!: Float
}
```

The brands are erased at runtime — an `ID` is a `string`, an `Int` is a `number` —
so they cost nothing and stay assignable from plain values.

## Why this matters

Because the schema is derived rather than declared, it cannot drift from your
implementation. Renaming a field is a TypeScript rename. Changing a return type to
something the resolver can't produce is a compile error, not a runtime surprise.

:::tip
String-literal unions become GraphQL **enums**, class inheritance becomes a GraphQL
**interface**, and a union of object types becomes a GraphQL **union** — see
[Interfaces & Unions](/docs/core-concepts/interfaces-unions).
:::

Resolver functions, arguments, and Shopify-style mutation payloads are covered next
in [Resolvers](/docs/core-concepts/resolvers).
