---
title: Querying
nav: Querying
description: Filter, order, paginate, search, and write — an immutable QuerySet with Prisma-shaped filters and Relay keyset pagination.
section: Data — pylon-db
order: 3
---

`Model.objects` is a `Manager`. Calling a query method on it returns a
`QuerySet` — an **immutable, chainable** description of a query that runs only
when you reach a terminal method like `.all()`. Each chain link returns a new
`QuerySet`, so you can branch a base query without mutating it.

```ts
const open = Task.objects.filter({status: 'OPEN'})
const mine = await open.filter({ownerId: me}).orderBy('-createdAt').all()
const count = await open.count() // `open` is unchanged
```

## Filtering

`.filter(where)` takes a Prisma-shaped `WhereInput`. A bare value is equality
shorthand; an operator object refines it:

```ts
// equality shorthand
await User.objects.filter({email: 'ada@example.com'}).all()

// operators
await Post.objects.filter({
  views: {gte: 100, lt: 1000},
  title: {contains: 'engine', mode: 'insensitive'}, // ILIKE — Postgres
  status: {in: ['OPEN', 'PENDING']},
  authorId: {not: null}
}).all()
```

Scalar operators: `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `contains`,
`startsWith`, `endsWith`, `not`, and `mode: 'insensitive'` for case-insensitive
string matches.

Combine clauses with `AND` / `OR` / `NOT`:

```ts
await Task.objects.filter({
  OR: [{ownerId: me}, {shared: true}],
  NOT: {status: 'ARCHIVED'}
}).all()
```

Filter across relations with a nested `WhereInput` (many-to-one) or
`some` / `every` / `none` (to-many):

```ts
await Post.objects.filter({author: {name: 'Ada'}}).all()
await Author.objects.filter({posts: {some: {published: true}}}).all()
```

## Ordering and limiting

`.orderBy('field')` sorts ascending; prefix with `-` for descending. `.limit(n)`
caps the result:

```ts
await Post.objects.orderBy('-createdAt').limit(10).all()
```

## Terminal methods

| Method | Returns |
| --- | --- |
| `.all()` | `T[]` — every matching row |
| `.first()` | `T \| null` — the first row, or null |
| `.get(where?)` | `T` — exactly one row; throws `NotFoundError` if missing |
| `.count()` | `number` — matching rows |
| `.paginate(args?)` | `Connection<T>` — a Relay page |

```ts
const task = await Task.objects.get({id: 42}) // throws NotFoundError if absent
const recent = await Task.objects.orderBy('-createdAt').first()
```

## Relay pagination

`.paginate()` returns a keyset-cursor `Connection<T>` —
`{edges, nodes, pageInfo, totalCount}`. It pages forward with `first`/`after` and
backward with `last`/`before`, keyed on `orderBy` (defaulting to the primary
key):

```ts
const page = await Post.objects
  .filter({published: true})
  .paginate({first: 20, after: cursor, orderBy: '-createdAt'})

page.nodes        // Post[]
page.edges        // {node, cursor}[]
page.pageInfo     // {hasNextPage, hasPreviousPage, startCursor, endCursor}
page.totalCount   // total matching the filter, ignoring the window
```

Return a `Connection` straight from a resolver and Pylon generates the Relay
connection type. On the frontend, drive it with
[`usePaginatedData`](/docs/frontend/pagination).

## The search-query DSL

Both `.query()` and `.paginate({query})` accept a Shopify/GitHub-style search
string, parsed against the model's columns and AND-ed onto the current filter.
It's a plain scalar — no per-model filter-input type required:

```ts
await Ticket.objects.query('status:OPEN -isRead:true "needs review"').all()
```

`field:value` matches, `-field:value` negates, and a quoted `"phrase"` does a
free-text match across the searchable columns.

## Full-text search

`.search(text, opts?)` runs a Postgres full-text query against the `tsvector`
column declared by [`@model({search})`](/docs/data/models#full-text-search). Pass
`{rank: true}` to order by relevance:

```ts
await Article.objects.search('postgres indexes', {rank: true}).limit(20).all()
```

## Writes

Create through the manager:

```ts
const user = await User.objects.create({email: 'ada@example.com', name: 'Ada'})
const many = await User.objects.createMany([{name: 'A'}, {name: 'B'}])
```

Update or delete an instance you've loaded:

```ts
user.name = 'Grace'
await user.$save()
await user.$delete()
```

Or run a **set-based** update or delete directly on a `QuerySet`. These hit the
database in one statement and return the affected count:

```ts
const archived = await Task.objects.filter({status: 'DONE'}).update({status: 'ARCHIVED'})
const removed = await Session.objects.filter({expiresAt: {lt: new Date()}}).delete()
```

:::warning
Set-based `.update()` / `.delete()` use Django semantics — they run as a single
SQL statement and **do not load instances or fire
[lifecycle signals](/docs/data/signals)**. Use `$save()` / `$delete()` (or
`createMany`) when you need hooks to run per row.
:::

## Bypassing scope

For trusted server code, `.unscoped()` skips tenant auto-scoping on a single
query; `runAsSystem()` runs a whole block with full access. See
[Multi-Tenancy](/docs/data/multi-tenancy) and
[Authorization Policies](/docs/data/policies).
