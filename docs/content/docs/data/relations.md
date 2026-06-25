---
title: Relations
nav: Relations
description: Foreign keys, one-to-many, and many-to-many — with batched, N+1-free loading and policy-aware reads.
section: Data — pylon-db
order: 2
---

`pylon-db` models relationships with four builders: `foreignKey`, `hasMany`,
`hasOne`, and `manyToMany`. Relation loads are **batched per request**, so
traversing a relation across a list never produces N+1 queries — and every read
**re-applies the target model's authorization policy and tenant scope**, so a
relation can't leak a row a direct query would have hidden.

## Foreign keys (many-to-one)

A `foreignKey` adds the FK scalar column on the child model. Pair it with a
`Relation<T>` accessor to load the parent:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, text, foreignKey, hasMany} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

class Author extends Model {
  static objects = manager(Author)
  id = id()
  name = text()
  posts = hasMany(() => Post, {foreignKey: 'authorId'})
}

class Post extends Model {
  static objects = manager(Post)
  id = id()
  title = text()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
}

// Related models are registered together in the app's db.models.
export default new Pylon({db: {models: [Author, Post]}})
```

The accessor resolves to the related row (or `null`), batched across the request:

```ts
const post = await Post.objects.get({id: 1})
const author = await post.author // Promise<Author | null>, batched
```

The accessor name defaults to the FK property with a trailing `Id` stripped
(`authorId` → `author`). Control deletion behavior with `onDelete`:

```ts
authorId = foreignKey(() => Author, {onDelete: 'cascade'})
// 'cascade' | 'set null' | 'restrict' | 'no action'
```

## One-to-many

`hasMany` is the reverse side of a foreign key — point it at the target and name
the FK property that references back. It returns a relation manager that is both
**thenable** (await it for the full list) and **chainable**:

```ts
const author = await Author.objects.create({name: 'Grace'})

// create children through the relation
await author.posts.createMany([{title: 'A'}, {title: 'B'}])

// await it directly for the full list
const all = await author.posts // Post[]

// or chain a query
const onlyA = await author.posts.filter({title: 'A'}).all()
const count = await author.posts.count()
```

`hasOne` is the singular form — the reverse of a foreign key that should resolve
to at most one row:

```ts
profile = hasOne(() => Profile, {foreignKey: 'userId'})
```

## Many-to-many

Declare `manyToMany` on both sides. Pylon manages the join table for you:

```ts
class Post extends Model {
  static objects = manager(Post)
  id = id()
  title = text()
  tags = manyToMany(() => Tag)
}

class Tag extends Model {
  static objects = manager(Tag)
  id = id()
  label = text()
  posts = manyToMany(() => Post)
}
```

The relation manager adds, removes, and replaces links — and reads from either
side:

```ts
const post = await Post.objects.create({title: 'Hello'})
const ts = await Tag.objects.create({label: 'ts'})
const orm = await Tag.objects.create({label: 'orm'})

await post.tags.add(ts, orm)  // idempotent
await post.tags.remove(orm)
await post.tags.set([ts])     // replace all links

const tags = await post.tags.all()
const back = await ts.posts.all() // works from either side
```

To bind an existing join table whose columns don't follow the default
convention, set `through` and the join columns explicitly:

```ts
tags = manyToMany(() => Tag, {
  through: 'post_tags',
  sourceColumn: 'post_id',
  targetColumn: 'tag_id'
})
```

:::note
When the two endpoints live in **different [apps](/docs/apps/overview)**, declare
the canonical side normally and mark the other `{inverse: true}`. The inverse
side reads and writes the join table the canonical side owns, but doesn't try to
create it — so each app's migrations stay independent.
:::

## Relation managers as `Manager`s

A relation manager exposes the full query surface: `.all`, `.filter`, `.create`,
`.add`, `.remove`, `.set`, and `.paginate`. Everything that works on
`Model.objects` works on a relation, scoped to the parent.

## Paginated relations

Mark a to-many relation `{paginate: true}` to expose it as a Relay `Connection`
instead of a plain list. The GraphQL field gains `first` / `after` / `last` /
`before` arguments and returns `{edges, nodes, pageInfo, totalCount}`:

```ts
posts = hasMany(() => Post, {foreignKey: 'authorId', paginate: true})
```

On the frontend, drive it with
[`usePaginatedData`](/docs/frontend/pagination).

## Filtering across relations

`WhereInput` understands relations. Filter a many-to-one with a nested object,
and a to-many with `some` / `every` / `none`:

```ts
// posts whose author is named "Ada"
await Post.objects.filter({author: {name: 'Ada'}}).all()

// authors with at least one post titled "Engines"
await Author.objects.filter({posts: {some: {title: 'Engines'}}}).all()
```

See [Querying](/docs/data/queries) for the full filter syntax.
