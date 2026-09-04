---
title: Models & Fields
nav: Models
description: Define database models as TypeScript classes — fields, columns, defaults, indexes, and full-text search in one place.
section: Data — pylon-db
order: 1
---

A model is a plain TypeScript class. It extends `Model` and exposes a
`static objects` manager; you register it on a [`Pylon`](/docs/apps/overview)
instance via the `db.models` constructor option. Each field is a call to a
builder whose return type is the value type, so `id = id()` types as `number`
and `email = text()` types as `string` — your instances are fully typed, with no
codegen step.

## Anatomy of a model

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, text, boolean, timestamp} from '@getcronit/pylon/db'

class User extends Model {
  static objects = manager(User)

  id = id()
  email = text({unique: true})
  name = text()
  isActive = boolean({default: true})
  createdAt = timestamp({defaultSql: 'now()'})
}

export default new Pylon({db: {models: [User]}})
```

Three things make a model:

- It **extends `Model`**, which provides instance methods like `$save()` and
  `$delete()` (see [Querying](/docs/data/queries)).
- It is **registered in an app's `db.models`**, which turns the field
  declarations into real columns and binds the model to that app.
- It exposes **`static objects = manager(Model)`** — the query manager you use to
  create and fetch rows.

The table name defaults to the snake-cased class name (`user`). Override it with
`static config = {table: 'users'} satisfies ModelConfig<User>`.

:::generates
```ts title="You write"
class User extends Model {
  id = id()
  email = text({unique: true})
  name = text()
  isActive = boolean({default: true})
}

export default new Pylon({db: {models: [User]}})
```

```sql title="Pylon generates"
CREATE TABLE "user" (
  "id"        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "email"     text NOT NULL UNIQUE,
  "name"      text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true
);
```
:::

## Field types

Every field is declared by calling a builder. Here are the scalar builders and
the columns they produce:

| Builder | Column | TypeScript |
| --- | --- | --- |
| `id()` | auto-incrementing `bigint` primary key | `number` |
| `id({snowflake: true})` | time-ordered snowflake `text` primary key | `string` |
| `uuid()` | UUID (pass `{primaryKey: true}` for a UUID PK) | `string` |
| `text()` | unbounded text | `string` |
| `varchar(n)` | `varchar(n)` | `string` |
| `int()` | 32-bit integer | `number` |
| `bigint()` | 64-bit integer | `number` |
| `numeric({precision, scale})` | decimal | `number` |
| `boolean()` | boolean | `boolean` |
| `timestamp()` | `timestamptz` | `Date` |
| `date()` | date | `Date` |
| `createdAt()` | timestamp, set on insert | `Date` |
| `updatedAt()` | timestamp, set on insert and every update | `Date` |
| `json<T>()` | `jsonb`, typed | `T` |
| `struct<T>()` | `jsonb`, typed | `T` |
| `enumOf(values)` | text + `CHECK` constraint | enum value |
| `array(text())` | Postgres array | `string[]` |
| `vector({dim})` | pgvector `vector(dim)` embedding | `number[]` |

`json<T>()` and `struct<T>()` both persist as `jsonb`; they differ on the wire.
`json` is an opaque `JSON` scalar — the client gets the whole blob and can't select
into it. `struct` reflects `T` into a real **nested GraphQL object type**, so the
shape is part of the schema and clients select individual sub-fields:

```ts
class Product extends Model {
  static objects = manager(Product)

  id = id()
  // opaque JSON scalar — { "width": 10, "height": 4 } as one value
  raw = json<{width: number; height: number}>()
  // a typed `ProductDimensions` object in the schema — query `dimensions { width }`
  dimensions = struct<{width: number; height: number}>()
}
```

### Vector embeddings

`vector({dim})` (or `models.Vector({dim})`) declares a fixed-length pgvector
embedding column — the `vector` Postgres extension is created automatically when a
model uses one. The value is a plain `number[]`, but it's **write-mostly**: the raw
embedding is excluded from the default `SELECT` (a 1024-dim vector is several KB per
row), so a loaded instance doesn't carry it back. You query by *similarity* with
[`.nearest()`](/docs/data/queries#vector-search), and index it for speed with an
[ANN index](#indexes) (`method: 'hnsw'`).

```ts
class Doc extends Model {
  static objects = manager(Doc)
  id = id()
  title = text()
  embedding = vector({dim: 1536, index: true}) // {index: true} → HNSW/cosine
}
```

For client-generated primary keys — snowflakes, cuid, uuid — and opt-in global
ids (`gid://…`), see [IDs & Global IDs](/docs/data/ids).

```ts
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, json, numeric, enumOf, array, text} from '@getcronit/pylon/db'

enum Plan {
  FREE = 'FREE',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE'
}

class Account extends Model {
  static objects = manager(Account)

  id = id()
  plan = enumOf(Plan)
  balance = numeric({precision: 12, scale: 2})
  tags = array(text())
  settings = json<{theme: 'light' | 'dark'}>()
}

export default new Pylon({db: {models: [Account]}})
```

## Field options

Every builder accepts a shared `FieldOptions` set:

```ts
text({
  column: 'email_address',   // override the column name
  unique: true,              // unique constraint
  index: true,               // secondary (non-unique) index
  nullable: true,            // allow null (types the field as string | null)
  primaryKey: true,          // make this column the primary key
  default: 'unknown',        // literal default applied on insert
  defaultSql: 'now()',       // raw SQL default expression (evaluated by the DB)
  check: "char_length(name) > 3", // raw column CHECK expression

  // Validation — runs before the write (see /docs/data/validation)
  min: 5,
  max: 255,
  pattern: /@/,
  email: true,
  validate: value => (String(value).includes('@') ? true : 'Must contain @'),
  schema: myZodSchema,       // any Standard Schema (Zod / Valibot / ArkType)

  hidden: true               // persist the column, hide it from GraphQL
})
```

:::note
Assigning `undefined` to a field means "leave this column untouched" (Prisma
semantics). Assigning `null` writes a real `NULL`.
:::

`default` also accepts a **function** — a client-side generator run per insert
(and never serialized into the schema), which is how text primary keys get
client-minted ids:

```ts
import {createId, uuidv4, snowflake} from '@getcronit/pylon/db'

class ApiKey extends Model {
  id = text({primaryKey: true, default: createId})   // cuid per row
  token = text({default: () => uuidv4()})
  issuedAt = timestamp({default: () => new Date()})
}
```

Use `defaultSql` instead when the database should compute it (`now()`,
`gen_random_uuid()`), so the default lives in the DDL rather than in app code.

## Hidden fields

Fields are exposed to GraphQL by default. To persist a column but keep it out of
the API, set `{hidden: true}` or prefix the property with `$`:

```ts
class Product extends Model {
  static objects = manager(Product)
  id = id()
  price = int()
  $cost = int() // persisted, never exposed to GraphQL
}
```

## Indexes

**Single-column** indexes live on the field via the `index` option; **composite**
indexes — spanning several columns — go in a `static config` block's `indexes`.

`index: true` is the zero-config shorthand (a btree, or an HNSW/cosine ANN index on a
`vector`). Pass an object to tune a single-column index — `method`
(`'hnsw'`/`'ivfflat'` for a `vector`), `metric` (`'cosine'` default, `'l2'`, `'ip'`),
and `with` (storage parameters):

```ts
class Doc extends Model {
  static objects = manager(Doc)
  id = id()
  title = text({index: true})                                          // btree
  embedding = vector({dim: 1536, index: {metric: 'l2', with: {m: 32}}}) // tuned HNSW
}
```

Composite indexes — and composite unique constraints — are declared on the model with
a `static config` block's `indexes`, where `columns` are property names:

```ts
class Person extends Model {
  static objects = manager(Person)
  static config = {
    indexes: [
      {columns: ['firstName', 'lastName'], unique: true},
      {columns: ['createdAt']}
    ]
  } satisfies ModelConfig<Person>
  id = id()
  firstName = text()
  lastName = text()
  createdAt = createdAt()
}
```

A composite index takes the same `method`/`metric`/`with` knobs — e.g. an ANN index
would rarely be composite, but a partial covering index over several columns is:

```ts
static config = {
  indexes: [{columns: ['orgId', 'userId'], unique: true}]
} satisfies ModelConfig<Membership>
```

## Full-text search

A `static config` block's `search` synthesizes a hidden, generated `tsvector`
column from the named property columns plus a GIN index — no triggers, never a
GraphQL field. Query it with [`Model.objects.search()`](/docs/data/queries#search):

```ts
class Article extends Model {
  static objects = manager(Article)
  static config = {
    search: {columns: ['title', 'body'], language: 'english'}
  } satisfies ModelConfig<Article>
  id = id()
  title = text()
  body = text()
}
```

For **several independent** search vectors on one model, pass an array and give each
a `name` (the generated column), then target one at query time with
`.search(text, {column})`:

```ts
class Product extends Model {
  static objects = manager(Product)
  static config = {
    search: [
      {name: 'nameFts', columns: ['name']},
      {name: 'descFts', columns: ['description'], language: 'english'}
    ]
  } satisfies ModelConfig<Product>
  id = id()
  name = text()
  description = text()
}

await Product.objects.search('wireless', {column: 'nameFts'}).all()
```

`name` defaults to `fts` for a single set, and is **required** once there's more
than one.

For substring matching inside a token (SKUs, handles, emails), add a trigram
index with `static config = {trigram: {columns: ['sku']}} satisfies ModelConfig<Product>` —
a `{contains}` filter on that column becomes index-backed instead of a sequential scan.

:::tip
Full-text search, trigram indexes, array columns, and `mode: 'insensitive'`
filters are Postgres features. `pylon-db` targets Postgres, so they're always
available.
:::

## Binding a model to an app

A model becomes live by being listed in an app's `db.models`. Give the
[`Pylon`](/docs/apps/overview) a `name` to group the model's migrations and
prefix its table; put shared ORM settings (tenant, secure, policy) alongside
`models` in the same `db` block:

```ts title="src/apps/blog/index.ts"
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, text, boolean, foreignKey, type ModelConfig} from '@getcronit/pylon/db'

class Post extends Model {
  static objects = manager(Post)

  id = id()
  title = text()
  published = boolean({default: false})
  authorId = foreignKey(() => User)

  // Typed config — column names are checked against THIS model's fields.
  static config = {
    indexes: [{columns: ['authorId', 'title']}],
    search: {columns: ['title']}
  } satisfies ModelConfig<Post>
}

export const blog = new Pylon({
  name: 'blog', // → table blog_post + its own migration group
  db: {models: [Post], tenant: 'authorId', secure: true}
})
```

`static config satisfies ModelConfig<Post>` puts a model's table options on the
model itself, with column names **type-checked against the model's own fields** —
a typo in `indexes` or `search` is a compile error. App-level ORM settings live
beside `models` in the `db` block: `new Pylon({name: 'blog', db: {models: [Post], tenant: 'authorId'}})`.

`ModelConfig<T>` accepts `table`, `abstract`, `secure`, `tenant` (a field name),
`indexes` (`{columns, unique?}[]`), `search`, `trigram`, and `query`.

:::generates
```ts title="You write"
class Post extends Model {
  id = id()
  title = text()
  published = boolean({default: false})

  static config = {
    indexes: [{columns: ['title']}]
  } satisfies ModelConfig<Post>
}

export const blog = new Pylon({name: 'blog', db: {models: [Post]}})
```

```sql title="Pylon generates"
CREATE TABLE "blog_post" (
  "id"        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "title"     text NOT NULL,
  "published" boolean NOT NULL DEFAULT false
);
CREATE INDEX "blog_post_title_idx" ON "blog_post" ("title");
```
:::

Declare a model's row-level access rules right next to its fields with
[`static abilities`](/docs/data/policies).

## `static config` options

`static config satisfies ModelConfig<T>` is where a model's table-level settings
live. Every key is type-checked against the model's own fields:

```ts
class Person extends Model {
  static objects = manager(Person)
  static config = {
    table: 'people',     // override the table name
    abstract: true,      // base model: contributes columns, has no table of its own
    tenant: 'orgId',     // tenant column for auto-scoping (see multi-tenancy)
    secure: true,        // deny-by-default authorization (see policies)
    indexes: [...],      // composite indexes
    search: {...},       // full-text search
    trigram: {...},      // substring search
    query: {...},        // the search-query DSL configuration
    inheritance: {...}   // single-table inheritance base (see below)
  } satisfies ModelConfig<Person>
  // ...fields
}
```

The migration group / app is set by the owning `Pylon`'s `name`, not on the
model — there's no per-model `app` key.

## Single-table inheritance

When several types share most of their columns — a media library of images and
videos, a feed of different post kinds — you can store them in **one table** and
tell them apart by a discriminator column. The base model declares `inheritance`
with the discriminator; each subclass `extends` it and sets its
`discriminatorValue`:

```ts
enum AssetKind {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO'
}

class Asset extends Model {
  static objects = manager(Asset)
  static config = {
    inheritance: {discriminator: 'kind'} // this column selects the subclass
  } satisfies ModelConfig<Asset>

  id = id()
  kind = enumOf(AssetKind)
  url = text()
}

class Video extends Asset {
  // the 2nd generic ('kind') type-checks discriminatorValue against that field
  static config = {discriminatorValue: AssetKind.VIDEO} satisfies ModelConfig<Video, 'kind'>
  durationSeconds = int()
}
```

All subclasses share the base's table; a query on `Asset.objects` returns every
kind, while `Video.objects` is automatically filtered to `kind = 'VIDEO'`. On the
GraphQL side the base projects to an **`interface Asset`** (no `I` prefix) that each
subclass implements — so it composes with everything on
[Interfaces & unions](/docs/core-concepts/interfaces-unions). Pass the discriminator
key as `ModelConfig`'s second generic (`<Video, 'kind'>`) to have
`discriminatorValue` type-checked against the field instead of a loose
`string | number`.

## The namespaced API

Every builder is also available capitalized on the `models` and `db` namespaces.
This is the idiomatic style for [apps](/docs/apps/overview):

```ts
import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon/db'

class User extends models.Model {
  static objects = db.manager(User)
  id = models.ID()
  email = models.Text({unique: true})
  createdAt = models.CreatedAt()
}

export default new Pylon({db: {models: [User]}})
```

The flat and namespaced styles are equivalent — pick one per project and keep it
consistent. Next, connect models together with
[relations](/docs/data/relations).
