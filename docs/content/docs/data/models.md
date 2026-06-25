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
import {Model, manager, id, text, boolean, timestamp} from '@getcronit/pylon-db'

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
| `enumOf(values)` | text + `CHECK` constraint | enum value |
| `array(text())` | Postgres array | `string[]` |

```ts
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, json, numeric, enumOf, array, text} from '@getcronit/pylon-db'

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
  defaultSql: 'now()',       // raw SQL default expression
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

Single-column indexes use the `index` field option. Composite indexes — and
composite unique constraints — are declared on the model with a `static config`
block's `indexes`, where `columns` are property names:

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
import {Model, manager, id, text, boolean, foreignKey, type ModelConfig} from '@getcronit/pylon-db'

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
    query: {...}         // the search-query DSL configuration
  } satisfies ModelConfig<Person>
  // ...fields
}
```

The migration group / app is set by the owning `Pylon`'s `name`, not on the
model — there's no per-model `app` key.

## The namespaced API

Every builder is also available capitalized on the `models` and `db` namespaces.
This is the idiomatic style for [apps](/docs/apps/overview):

```ts
import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon-db'

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
