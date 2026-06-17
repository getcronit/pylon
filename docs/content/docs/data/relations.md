---
title: Relations
description: Foreign keys, one-to-many, and many-to-many relationships — with batched, N+1-free loading.
section: Data — pylon-db
order: 1
---

Pylon ORM models relationships with three builders: `foreignKey`, `hasMany`, and
`manyToMany`. Relation loads are **batched per request**, so traversing relations
never produces N+1 queries.

## Foreign keys (many-to-one)

A `foreignKey` adds the FK column on the child model. Pair it with a `Relation<T>`
accessor to load the parent:

```ts
import {Model, manager, id, text, foreignKey, hasMany} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

@model()
class Author extends Model {
  static objects = manager(Author)
  id = id()
  name = text()
  posts = hasMany(() => Post, {foreignKey: 'authorId'})
}

@model()
class Post extends Model {
  static objects = manager(Post)
  id = id()
  title = text()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
}
```

The accessor returns a promise that resolves to the related row (or `null`):

```ts
const post = await Post.objects.get({id: 1})
const author = await post.author // Promise<Author | null>, batched
```

By default the accessor name is the FK property with a trailing `Id` stripped
(`authorId` → `author`). Configure deletion behavior with `onDelete`:

```ts
authorId = foreignKey(() => Author, {onDelete: 'cascade'})
// 'cascade' | 'set null' | 'restrict' | 'no action'
```

## One-to-many

`hasMany` is the reverse side of a foreign key. It returns a manager that is both
**awaitable** and **chainable**:

```ts
const author = await Author.objects.create({name: 'Grace'})

// create children through the relation
await author.posts.createMany([{title: 'A'}, {title: 'B'}])

// await it directly to get the full list
const all = await author.posts // Post[]

// or chain a filter
const onlyA = await author.posts.filter({title: 'A'}).all()

const count = await author.posts.count()
```

## Many-to-many

Declare `manyToMany` on both sides. Pylon manages the join table for you:

```ts
@model()
class Post extends Model {
  static objects = manager(Post)
  id = id()
  title = text()
  tags = manyToMany(() => Tag)
}

@model()
class Tag extends Model {
  static objects = manager(Tag)
  id = id()
  label = text()
  posts = manyToMany(() => Post)
}
```

The relation manager supports adding, removing, and replacing links:

```ts
const post = await Post.objects.create({title: 'Hello'})
const ts = await Tag.objects.create({label: 'ts'})
const orm = await Tag.objects.create({label: 'orm'})

await post.tags.add(ts, orm)      // idempotent
await post.tags.remove(orm)
await post.tags.set([ts])         // replace all links
await post.tags.clear()           // remove all links

const tags = await post.tags.all()
const back = await ts.posts.all() // works from either side
```

To control the join table explicitly:

```ts
tags = manyToMany(() => Tag, {
  through: 'post_tags',
  sourceColumn: 'post_id',
  targetColumn: 'tag_id'
})
```

## Filtering across relations

`WhereInput` understands relations. Filter a belongs-to relation with a nested
object, and a to-many relation with `some` / `every` / `none`:

```ts
// posts whose author is named "Ada"
await Post.objects.filter({author: {name: 'Ada'}}).all()

// authors who have at least one post titled "Engines"
await Author.objects.filter({posts: {some: {title: 'Engines'}}}).all()
```

See [Queries](/docs/data/queries) for the full filter syntax.
