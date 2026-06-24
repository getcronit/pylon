---
title: Migrating from Prisma
description: Map Prisma concepts to Pylon ORM — and lose the separate API layer entirely, because the model is the GraphQL type.
section: Guides
order: 7
---

If you're coming from Prisma, Pylon ORM will feel familiar: models, a typed query
API, and migrations. Two things change. Your models are **TypeScript classes**
instead of a `.prisma` schema, and — this is the big one — **the same model also
is your GraphQL type**, so there's no separate API layer to build and keep in
sync. One class drives the table, the migrations, the query API, and the schema.

## Concept mapping

| Prisma | Pylon ORM |
| --- | --- |
| `schema.prisma` model | a `@model()` TypeScript class |
| `String` / `Int` / `Boolean` field | `text()` / `int()` / `boolean()` builders |
| `@id @default(autoincrement())` | `id()` |
| `@unique` | `text({unique: true})` |
| `@@index([a, b])` | `@model({indexes: [{columns: ['a', 'b']}]})` |
| `@relation(fields, references)` | `foreignKey(() => Other)` |
| reverse relation (`Post[]`) | `hasMany(() => Post)` |
| implicit m-n (`Tag[]` ↔ `Post[]`) | `manyToMany(() => Tag)` |
| Prisma Client types | the model class itself |
| `prisma.user.findMany({where})` | `User.objects.filter(where).all()` |
| `findUnique({where})` | `User.objects.get({...})` |
| `findFirst({where})` | `User.objects.filter({...}).first()` |
| `create({data})` | `User.objects.create({...})` |
| `update({where, data})` | load, mutate, `instance.$save()` |
| `delete({where})` | `instance.$delete()` |
| `where`, `OR`, `AND`, `contains`, `in` | the same — see [Queries](/docs/data/queries) |
| `prisma migrate dev` | `pylon db diff` + `pylon db migrate` |
| `prisma migrate deploy` | `pylon db deploy` |
| `prisma db push` | `pylon db push` |
| (no equivalent — a separate resolver layer) | the model **is** the GraphQL type |

## A model, side by side

```prisma title="schema.prisma"
model Post {
  id        Int      @id @default(autoincrement())
  title     String
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
}
```

```ts title="src/models.ts"
import {Model, manager, model, id, text, boolean, createdAt, foreignKey} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

@model()
export class Post extends Model {
  static objects = manager(Post)

  id = id()
  title = text()
  published = boolean({default: false})
  authorId = foreignKey(() => User)
  declare author: Relation<User>
  createdAt = createdAt()
}
```

The class needs no decorators per field — the builder's return type *is* the
TypeScript type, so `id = id()` is a `number`, `title = text()` is a `string`, and
your instances are fully typed. See [Models & Fields](/docs/data/models).

## Queries

The query manager replaces the Prisma Client. `Model.objects` returns chainable
query sets; terminal methods like `.all()`, `.get()`, and `.count()` execute.

```ts
// Prisma
const posts = await prisma.post.findMany({
  where: {author: {name: 'Ada'}, published: true},
  orderBy: {createdAt: 'desc'},
  take: 10
})

// Pylon
const posts = await Post.objects
  .filter({author: {name: 'Ada'}, published: true})
  .orderBy('-createdAt')
  .limit(10)
  .all()
```

Writes load-mutate-save instead of taking a `data` object:

```ts
// Prisma
await prisma.post.update({where: {id}, data: {published: true}})

// Pylon
const post = await Post.objects.get({id})
post.published = true
await post.$save()
```

The `where` syntax — `OR`, `AND`, `contains`, `in`, `gt`/`lte`, nested relation
filters — carries over almost unchanged. See [Queries](/docs/data/queries).

## The model is the API

This is the difference that removes the most code. In Prisma, the database model
and the GraphQL type are different things — you write a `schema.prisma`, then a
GraphQL SDL (or a code-first builder), then resolvers that translate between them.
In Pylon, the class you query is the class you expose:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {Post} from './models.js'

export default new Pylon({
  graphql: {
    Query: {
      // returns Post instances — the GraphQL `Post` type is derived from the class
      posts: (): Promise<Post[]> => Post.objects.filter({published: true}).all()
    }
  }
})
```

:::generates
```ts title="You write"
class Post extends Model {
  id = id()
  title = text()
  published = boolean()
}
```

```graphql title="Pylon generates"
type Post {
  id: ID!
  title: String!
  published: Boolean!
}
```
:::

There is no SDL file, no resolver-to-DTO mapping, no second set of types to keep
aligned. Hide a column from the API with `{hidden: true}` or a `$`-prefixed
property name when you need persistence without exposure. See
[Type-driven schema](/docs/core-concepts/type-driven-schema).

## Migration steps

1. **Bring your existing database across.** You don't have to recreate the schema
   by hand. Point Pylon at the live database and adopt it:

   ```bash
   pylon db baseline
   ```

   `baseline` introspects the database, writes model stubs you can refine, and
   records an initial migration as already applied — so your next `pylon db diff`
   produces a clean forward migration from there.

2. **Refine the generated models.** Replace remaining Prisma idioms: `@relation`
   becomes `foreignKey`/`hasMany`/`manyToMany`, `@@index` becomes the model-level
   `indexes` option, and add validation (`min`, `max`, `pattern`, `schema`) where
   you previously validated in application code.

3. **Generate forward migrations from changes.** From now on, change a model and
   capture the diff:

   ```bash
   pylon db diff add-published-flag
   pylon db migrate
   ```

4. **Swap the client calls.** Replace `prisma.x.findMany/create/update/delete`
   with the manager equivalents from the table above. The Prisma Client import
   and `PrismaClient` instance go away — `Model.objects` needs no client object.

5. **Delete the API layer.** Remove the SDL/resolver mapping and expose models
   directly through `new Pylon({graphql})`. Run `pylon dev` and check the schema
   in GraphiQL at `/graphql`.

In CI, replace `prisma migrate deploy` with `pylon db deploy`, and add
`pylon db check` as a gate — it fails the build on uncaptured model changes,
schema drift, or tampered migration history. See
[Migrations](/docs/data/migrations) and the [CLI reference](/docs/reference/cli).

## What you gain

Beyond the ORM, the same models now drive a GraphQL API and a
[usePages frontend](/docs/frontend/overview), with
[row-level abilities](/docs/data/policies),
[multi-tenancy](/docs/data/multi-tenancy),
[signals](/docs/data/signals), and [background queues](/docs/queues/overview) in
one toolchain — no separate API service to build and deploy on top.
