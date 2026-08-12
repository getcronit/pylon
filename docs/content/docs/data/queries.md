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

**Array columns** (`array(text())`, `int[]`, …) take their own operator set:

```ts
await Post.objects.filter({
  tags: {has: 'urgent'},          // the array contains this element
  labels: {hasSome: ['a', 'b']},  // overlaps any of these  (Postgres &&)
  flags: {hasEvery: ['x', 'y']},  // contains all of these  (Postgres @>)
  notes: {isEmpty: true}          // zero-length array
}).all()
```

Use `{equals: [...]}` to match the whole array exactly.

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
| `.exists()` | `boolean` — true if any row matches |
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
page.startIndex   // absolute index of nodes[0] in the full ordered list (see anchor)
```

`paginate` takes a few more args beyond the cursors:

- **`orderBy`** also accepts an **array** for a composite keyset — `['-type',
  'name']` groups by one column then sorts within it (the primary key is appended
  as a tiebreaker so the cursor stays stable).
- **`skip`** is an offset fallback (forward only), applied before the limit.
- **`anchor`** seeks to a row by primary key and pages from its **absolute index**
  (returned as `startIndex`), so a virtualized list can SSR already scrolled to it —
  no client jump after hydration. An explicit cursor/`skip` wins over it, and it
  can't be combined with relevance ordering (`.search({rank: true})`).
- **`query`** applies a [search-DSL](#the-search-query-dsl) string to the page.

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

The grammar is Shopify's Admin-API search syntax:

| Construct | Meaning |
| --- | --- |
| `field:value` | equality, coerced to the column type |
| `field:>10` `field:<=5` | comparators (numbers / dates) |
| `field:val*` | prefix match (case-insensitive) |
| `field:*` | the column is non-null (exists) |
| `value` / `val*` | default search — contains / prefix over the model's text columns |
| `"a phrase"` | a verbatim value; specials inside are literal |
| `-term` / `NOT term` | negation |
| `a b` / `a AND b` / `a OR b` | connectives — space means AND; **OR binds tighter** |
| `(a OR b) c` | grouping |
| `vendor.name:nike` | a dotted path filters across a relation |
| `\:` `\(` `\*` | backslash-escapes a special character |

Precedence follows Shopify: `a OR b AND c` parses as `(a OR b) AND c`. Unknown
fields are **skipped** (lenient) by default, so a frontend typo degrades to "no
constraint" rather than an error.

:::note
When you expose the DSL on a public GraphQL argument, call
`.query(str, {scope: 'public'})` — it rejects unknown/internal fields with a
`QueryParseError` and caps the boolean-node count, instead of silently ignoring
them. Which fields are queryable is set per model via `static config.query`.
:::

## Full-text search

`.search(text, opts?)` runs a Postgres full-text query against the `tsvector`
column declared by [`static config`'s `search`](/docs/data/models#full-text-search). Pass
`{rank: true}` to order by relevance:

```ts
await Article.objects.search('postgres indexes', {rank: true}).limit(20).all()
```

On a model with more than one `tsvector` column, target one with `{column:
'bodyFts'}`; override the text-search language (default `english`) with
`{language: 'simple'}`.

## Vector search

`.nearest(vec)` runs a pgvector k-nearest-neighbour search against a
[`vector`](/docs/data/models#vector-embeddings) column — rows ordered by their
embedding's distance to `vec`, closest first. It composes with `.filter()` and the
tenant scope (a pre-filter before the ANN scan), and returns a narrow query with two
terminals: `.matches()` for rows **with** their similarity score, `.all()` for just
the rows.

```ts
// { item, score }[] — score is the similarity (higher = closer); item excludes the vector
const hits = await Doc.objects
  .filter({workspaceId})            // pre-filter, tenant-scoped as usual
  .nearest(queryEmbedding, {k: 5})  // top 5 by distance
  .matches()

hits[0].item.title // the closest document
hits[0].score      // e.g. 0.91
```

`k` caps the result (a `LIMIT`). The vector column is auto-discovered when the model
has exactly one; otherwise pass `{column: 'embedding'}`. `metric` defaults to the
column's ANN-index metric (`'cosine'`, else `'l2'` / `'ip'`) and must match the index
to use it. Distance ordering has no seekable cursor, so `.nearest()` **can't** be
combined with `.paginate()` — raise `k` instead.

Hybrid search (dense + full-text) is composed in application code by fusing a
`.nearest()` and a `.search()` result list — the framework supplies both ranked
inputs.

## Writes

Create through the manager:

```ts
const user = await User.objects.create({email: 'ada@example.com', name: 'Ada'})
const many = await User.objects.createMany([{name: 'A'}, {name: 'B'}])
```

**Upsert** — insert a row, or update it if it conflicts — is a single atomic
`INSERT … ON CONFLICT DO UPDATE`. `onConflict` names the property keys of a unique
index (the conflict target); `update` the keys to overwrite (default: every provided
column except the conflict target and primary key). It's tenant-safe: the ambient
tenant is stamped on insert and a conflict can never touch another tenant's row.

```ts
await Embedding.objects.upsert(
  {objectRef: 'artikel/HEL-20L', model: 'voyage-3', embedding, contentHash},
  {onConflict: ['tenantId', 'objectRef', 'model'], update: ['embedding', 'contentHash']}
)
await Embedding.objects.upsertMany(rows, {onConflict: ['objectRef', 'model'], update: ['embedding']})
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

Set-based writes still fire **post** [signals](/docs/data/signals) by default: the
affected rows are captured with `RETURNING` (one statement, no extra `SELECT`),
hydrated, and handed to `postSave(created: false)` / `postDelete`, inside a
transaction — so audit and realtime receivers see bulk changes too. Only the
**pre** hooks (`preSave` / `preDelete`) are skipped, since they run before a write
and a single `RETURNING` statement has no per-row "before" phase. A set-based
UPDATE also omits the `changes` diff (there's no per-row baseline).

```ts
// fires postSave for every archived task; opt a large bulk op out with {signals: false}
await Task.objects.filter({status: 'DONE'}).update({status: 'ARCHIVED'})
await Session.objects.filter({expiresAt: {lt: new Date()}}).delete({signals: false})
```

:::note
Reach for `$save()` / `$delete()` (or `createMany`) when you need a **pre** hook —
a `preSave` validation gate, say — to run per row.
:::

## Bypassing scope

For trusted server code, `.unscoped()` skips tenant auto-scoping on a single
query; `runAsSystem()` runs a whole block with full access. See
[Multi-Tenancy](/docs/data/multi-tenancy) and
[Authorization Policies](/docs/data/policies).
