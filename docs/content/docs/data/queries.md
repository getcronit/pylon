---
title: Queries
description: Create, read, update, delete — plus filtering, ordering, pagination, and full-text search through the manager API.
section: Data — pylon-db
order: 2
---

Every model exposes a typed query manager as `Model.objects`. Managers return
chainable query sets; terminal methods like `.all()`, `.get()`, and `.count()`
execute the query.

## Create

```ts
const user = await User.objects.create({email: 'a@b.co', name: 'Ada'})
// auto-generated id, defaults, and server timestamps are backfilled

const many = await User.objects.createMany([
  {email: 'b@b.co', name: 'Bo'},
  {email: 'c@b.co', name: 'Cy'}
])
```

## Read

```ts
// get() returns exactly one row, or throws NotFoundError
const ada = await User.objects.get({email: 'a@b.co'})

// all rows
const users = await User.objects.all()

// first() returns one row or null
const first = await User.objects.filter({isActive: true}).first()

// count
const active = await User.objects.filter({isActive: true}).count()
```

## Update

Load a row, mutate it, and persist with `$save()`:

```ts
const ada = await User.objects.get({email: 'a@b.co'})
ada.name = 'Ada Lovelace'
await ada.$save()
```

Or update many rows at once:

```ts
const changed = await User.objects.filter({isActive: false}).update({isActive: true})
// returns the number of rows updated
```

## Delete

```ts
const ada = await User.objects.get({id: 1})
await ada.$delete()

// bulk delete returns the count
const removed = await User.objects.filter({isActive: false}).delete()
```

## Filtering

`filter()` takes a typed `WhereInput`. Use shorthand equality, or per-field
operators:

```ts
// shorthand equality
await Widget.objects.filter({name: 'Alpha', active: true}).all()

// comparison operators
await Widget.objects.filter({qty: {gt: 10}}).all()
await Widget.objects.filter({qty: {gte: 10, lte: 20}}).all()

// strings
await Widget.objects.filter({name: {contains: 'amm'}}).all()
await Widget.objects.filter({name: {startsWith: 'Al'}}).all()
await Widget.objects.filter({name: {contains: 'alph', mode: 'insensitive'}}).all()

// sets and null
await Widget.objects.filter({plan: {in: ['PRO', 'ENTERPRISE']}}).all()
await Widget.objects.filter({note: {not: null}}).all()

// arrays
await Widget.objects.filter({tags: {has: 'red'}}).all()
await Widget.objects.filter({tags: {hasEvery: ['red', 'blue']}}).all()
```

Combine conditions with `AND`, `OR`, and `NOT`:

```ts
await Widget.objects
  .filter({OR: [{active: true}, {qty: {gte: 5}}]})
  .all()
```

Available operators: `equals`, `not`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`,
`contains`, `startsWith`, `endsWith`, `mode: 'insensitive'`, and the array
operators `has`, `hasEvery`, `hasSome`, `isEmpty`.

## Ordering and limiting

```ts
// ascending by name, descending by createdAt
await Widget.objects.orderBy('name').all()
await Widget.objects.orderBy('-createdAt').limit(10).all()
```

## Pagination

`paginate()` returns a Relay-style connection with cursors:

```ts
const page = await Widget.objects.paginate({first: 20})

page.nodes          // Widget[]
page.edges          // { cursor, node }[]
page.totalCount     // total matching rows (ignores the cursor window)
page.pageInfo       // { hasNextPage, hasPreviousPage, startCursor, endCursor }

// next page
const next = await Widget.objects.paginate({
  first: 20,
  after: page.pageInfo.endCursor!
})

// order and paginate together
await Widget.objects.paginate({first: 10, orderBy: '-createdAt'})

// backward pagination
await Widget.objects.paginate({last: 10, before: page.pageInfo.startCursor!})

// compose with a filter
await Widget.objects.filter({active: true}).paginate({first: 10})
```

## Full-text search

Declare searchable columns on the model, then use `.search()` (Postgres only). A
stored `tsvector` column with a GIN index is generated for you:

```ts
@model({search: {columns: ['title', 'body'], language: 'english'}})
class Doc extends Model {
  static objects = manager(Doc)
  id = id()
  title = text()
  body = text()
}

// websearch_to_tsquery — accepts raw user input
await Doc.objects.search('postgres tsvector').all()

// rank by relevance, then compose
await Doc.objects.search('fox', {rank: true}).paginate({first: 10})
```
