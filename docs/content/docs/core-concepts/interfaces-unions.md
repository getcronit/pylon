---
title: Interfaces & Unions
description: Model polymorphism with TypeScript inheritance and union types — generated as GraphQL interfaces and unions.
section: Core Concepts
order: 2
---

Pylon maps two TypeScript patterns to GraphQL's polymorphic types: class
inheritance becomes a GraphQL **interface**, and a union type becomes a GraphQL
**union**.

## Interfaces from inheritance

A base class implemented by subclasses generates a GraphQL interface plus the
concrete types that implement it:

```ts
class Media {
  id!: string
  url!: string
}

class Image extends Media {
  width!: number
  height!: number
  altText!: string | null
}

class Video extends Media {
  durationSeconds!: number
  captions!: string[]
}

export default new Pylon({
  graphql: {
    Query: {
      // returns the Media interface; resolves to Image or Video at runtime
      media: (): Media[] => []
    }
  }
})
```

Clients can select common fields directly and concrete fields with inline
fragments:

```graphql
{
  media {
    id
    url
    ... on Image { width height }
    ... on Video { durationSeconds }
  }
}
```

## Unions from union types

A TypeScript union of object types becomes a GraphQL union:

```ts
class Post {
  id!: string
  title!: string
}

class User {
  id!: string
  name!: string
}

type SearchResult = Post | User

export default new Pylon({
  graphql: {
    Query: {
      search: (query: string): SearchResult[] => []
    }
  }
})
```

```graphql
{
  search(query: "ada") {
    ... on Post { title }
    ... on User { name }
  }
}
```

## Enums

String-literal union types become GraphQL enums:

```ts
type Role = 'ADMIN' | 'AUTHOR' | 'READER'

class User {
  id!: string
  role!: Role // generated as enum Role { ADMIN AUTHOR READER }
}
```

Because every one of these types is derived from your TypeScript, the schema
always matches your code — there's no separate SDL to keep aligned.
