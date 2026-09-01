---
title: Interfaces & Unions
nav: Interfaces & Unions
description: Enums, interfaces, and unions fall out of ordinary TypeScript — literal unions, class inheritance, and object unions.
section: Core Concepts
order: 5
---

GraphQL's polymorphic types — enums, interfaces, and unions — all have natural
TypeScript counterparts, and Pylon derives each from the construct you'd reach for
anyway. **You express variation in TypeScript; the schema mirrors it.**

## Enums from string-literal unions

A union of string literals becomes a GraphQL enum:

:::generates
```ts title="You write"
type Role = 'ADMIN' | 'EDITOR' | 'READER'

class User {
  id!: string
  role!: Role
}
```

```graphql title="Pylon generates"
enum Role {
  ADMIN
  EDITOR
  READER
}

type User {
  id: String!
  role: Role!
}
```
:::

## Interfaces from class inheritance

When classes share a base class, the base becomes a GraphQL interface and each
subclass an implementing type:

:::generates
```ts title="You write"
class Node {
  id!: string
}

class Post extends Node {
  title!: string
}

class Comment extends Node {
  body!: string
}
```

```graphql title="Pylon generates"
interface Node {
  id: String!
}

type Post implements Node {
  id: String!
  title: String!
}

type Comment implements Node {
  id: String!
  body: String!
}
```
:::

## Unions from object-type unions

A TypeScript union of object types — types that share no base class — becomes a
GraphQL union:

:::generates
```ts title="You write"
class TextBlock {
  text!: string
}

class ImageBlock {
  url!: string
  alt!: string | null
}

type Block = TextBlock | ImageBlock

new Pylon({
  graphql: {
    Query: {blocks: (): Block[] => []}
  }
})
```

```graphql title="Pylon generates"
union Block = TextBlock | ImageBlock

type Query {
  blocks: [Block!]!
}
```
:::

## `__typename`

Clients resolve which member they received with the standard `__typename` field,
available on every interface and union:

```graphql
{
  blocks {
    __typename
    ... on TextBlock { text }
    ... on ImageBlock { url }
  }
}
```

At runtime Pylon resolves the concrete type from the object you return — the class
instance for interfaces, the matching shape for unions — so you return ordinary
objects and the right `__typename` follows.

:::note
That `... on TextBlock { … }` syntax is the raw GraphQL. In a usePages frontend you
don't write it: you read member fields flatly and narrow on `__typename`, and the
build step compiles the inline fragments. See
[Interfaces & unions in `useData`](/docs/frontend/use-data#interfaces--unions-inline-fragments).
:::

:::note
Polymorphic types compose across services too. When stitching a remote API, an
interface is resolved through a patch plus `__typename` — see
[Gateway](/docs/core-concepts/gateway).
:::
