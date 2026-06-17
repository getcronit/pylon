---
title: Migrating from Prisma
description: A mapping from Prisma concepts to Pylon ORM, and how to move an existing database across.
section: Guides
order: 2
---

If you're coming from Prisma, Pylon ORM will feel familiar — models, a typed
query API, and migrations — with two differences: models are **TypeScript
classes** rather than a `.prisma` schema, and the same models also shape your
**GraphQL API**.

## Concept mapping

| Prisma | Pylon ORM |
| --- | --- |
| `schema.prisma` model | a `@model()` class |
| `prisma.user.findMany()` | `User.objects.all()` |
| `findUnique({where})` | `User.objects.get({...})` |
| `findFirst({where})` | `User.objects.filter({...}).first()` |
| `create({data})` | `User.objects.create({...})` |
| `update({where, data})` | load, mutate, `instance.$save()` |
| `delete({where})` | `instance.$delete()` |
| `where`, `OR`, `AND`, `contains` | the same — see [Queries](/docs/data/queries) |
| `@relation` | `foreignKey` / `hasMany` / `manyToMany` |
| `@@index` | `@model({indexes: […]})` |
| `prisma migrate dev` | `pylon db diff` + `pylon db migrate` |
| Prisma Client types | inferred from your classes |

## A model, side by side

```prisma
// Prisma
model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
}
```

```ts
// Pylon
@model()
class Post extends Model {
  static objects = manager(Post)
  id = id()
  title = text()
  authorId = foreignKey(() => User)
  declare author: Relation<User>
}
```

## Queries

```ts
// Prisma
const posts = await prisma.post.findMany({
  where: {author: {name: 'Ada'}},
  orderBy: {createdAt: 'desc'},
  take: 10
})

// Pylon
const posts = await Post.objects
  .filter({author: {name: 'Ada'}})
  .orderBy('-createdAt')
  .limit(10)
  .all()
```

## Bringing an existing database

You don't have to recreate your schema by hand. Point Pylon at an existing
database and let it adopt it:

```bash
pylon db baseline
```

This introspects the database, writes model stubs you can refine, and records an
initial migration as already applied — so your next `pylon db diff` produces a
clean forward migration from there.

## What you gain

Beyond the ORM, the same models now drive a GraphQL API, and you get
[row-level policies](/docs/data/policies), [multi-tenancy](/docs/data/multi-tenancy),
[signals](/docs/data/signals), and [background queues](/docs/queues/overview) in
the same toolchain — no separate API layer to build on top.
