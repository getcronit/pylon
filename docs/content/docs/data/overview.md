---
title: Overview
description: Why Pylon ships its own ORM, and how the data layer fits the type-driven model.
section: Data — pylon-db
order: -1
nav: Overview
---

`@getcronit/pylon-db` is Pylon's database layer. It isn't a thin query builder
bolted onto the side — it's a full ORM that participates in the same
type-introspection pipeline as your API, so a model is **one definition** that
becomes both a GraphQL type and a database table.

## Why an ORM in the framework

Most type-safe API tools stop at the API and hand you off to a separate ORM. That
works, but it reintroduces the very thing Pylon exists to remove: two sources of
truth that can drift. By owning the data layer, Pylon can:

- derive your **SQL schema and migrations** from the same models that shape your
  API ([how it works](/docs/how-pylon-works));
- apply **authorization** and **tenant scoping** at the data layer, so they cover
  every query and relation load automatically;
- run **lifecycle signals** inside the same transaction as your writes;
- keep relation loading **batched** so traversing your graph never causes N+1
  queries.

## What's in the box

| Capability | Page |
| --- | --- |
| Models, fields, and columns | [Models & Fields](/docs/data/models) |
| Foreign keys, one-to-many, many-to-many | [Relations](/docs/data/relations) |
| Create, read, update, delete, filter, paginate | [Queries](/docs/data/queries) |
| Validation before every write | [Validation](/docs/data/validation) |
| Row-level authorization | [Policies](/docs/data/policies) |
| Lifecycle hooks | [Signals](/docs/data/signals) |
| Tenant scoping and feature flags | [Multi-tenancy](/docs/data/multi-tenancy) |
| Authored, reviewable schema migrations | [Migrations](/docs/data/migrations) |

## A taste

```ts
import {Model, manager, id, text, hasMany, foreignKey} from '@getcronit/pylon-db'
import {model} from '@getcronit/pylon-db'

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
}

// query
const author = await Author.objects.get({name: 'Ada'})
const posts = await author.posts.all()
```

The ORM works on PostgreSQL. It can be used on its own — `connect()` a database
and call your managers — but inside a Pylon app you'll usually add the
[`useDatabase`](/docs/data/database) plugin, which binds a connection,
transactions, and the request principal/tenant for you.

Start with [Connecting a database](/docs/data/database), then
[Models & Fields](/docs/data/models).
