---
title: Models & Fields
description: Define database models as TypeScript classes — fields, columns, defaults, indexes, and validation in one place.
section: Data — pylon-db
order: 0
---

Pylon ships its own ORM, `@getcronit/pylon-db`. You define models as TypeScript
classes; the same definitions drive your database schema, migrations, and the
types your resolvers return. There is no separate schema file to keep in sync.

## A first model

One class definition becomes both a database table and a GraphQL type:

:::generates
```ts title="A model"
@model()
class User extends Model {
  static objects = manager(User)

  id = id()
  email = text({unique: true})
  name = text()
  isActive = boolean({default: true})
}
```

```sql title="The table Pylon creates"
CREATE TABLE "user" (
  "id"        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "email"     text NOT NULL UNIQUE,
  "name"      text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true
);
```
:::

Here's the full definition with imports:

```ts title="src/models.ts"
import {Model, manager, model, id, text, boolean, timestamp} from '@getcronit/pylon-db'

@model()
class User extends Model {
  static objects = manager(User)

  id = id()
  email = text({unique: true})
  name = text()
  isActive = boolean({default: true})
  createdAt = timestamp({defaultSql: 'now()'})
}
```

Three things make a model:

- It **extends `Model`**, which provides instance methods like `$save()` and `$delete()`.
- It is decorated with **`@model()`**, which registers it and turns the field
  declarations into real columns.
- It exposes a **`static objects = manager(Model)`** — the query manager you use
  to create and fetch rows (see [Queries](/docs/data/queries)).

The table name defaults to the snake-cased class name (`user`). Override it with
`@model({table: 'users'})`.

## Field types

Every field is declared by calling a field builder. The builder's return type is
the value type, so `id = id()` gives you a `number`, `email = text()` gives you a
`string`, and so on — your instances are fully typed.

| Builder | Column | TypeScript |
| --- | --- | --- |
| `id()` | auto-incrementing `bigint` primary key | `number` |
| `uuid()` | UUID | `string` |
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
import {json, numeric, enumOf, array, int, text} from '@getcronit/pylon-db'

enum Plan {
  FREE = 'FREE',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE'
}

@model()
class Account extends Model {
  static objects = manager(Account)

  id = id()
  plan = enumOf(Plan)
  balance = numeric({precision: 12, scale: 2})
  tags = array(text())
  settings = json<{theme: 'light' | 'dark'}>()
}
```

## Field options

Every builder accepts a shared set of options:

```ts
text({
  column: 'email_address', // override the column name
  unique: true,            // unique constraint
  index: true,             // secondary (non-unique) index
  nullable: true,          // allow null (types the field as string | null)
  default: 'unknown',      // client-side default on insert
  defaultSql: 'now()',     // SQL default expression
  check: "length(email) > 3", // raw CHECK expression

  // Validation (runs before the write — see /docs/data/validation)
  min: 5,
  max: 255,
  pattern: /@/,
  email: true,
  validate: value => (value.includes('@') ? true : 'Must contain @'),
  schema: myZodSchema      // any Standard Schema (Zod / Valibot / ArkType)
})
```

:::note
Assigning `undefined` to a field means "leave this column untouched" (Prisma
semantics). Assigning `null` writes a real `NULL`.
:::

## Hidden fields

Fields are exposed to GraphQL by default. To keep a column out of the API, set
`{hidden: true}` or prefix the property with `$`:

```ts
@model()
class Product extends Model {
  static objects = manager(Product)
  id = id()
  price = int()
  $cost = int() // persisted, never exposed to GraphQL
}
```

## Indexes

Single-column indexes use the `index` option. Composite indexes are declared on
the model:

```ts
@model({
  indexes: [{columns: ['firstName', 'lastName'], unique: true}]
})
class Person extends Model {
  static objects = manager(Person)
  id = id()
  firstName = text()
  lastName = text()
}
```

## The namespaced API

Every builder is also available as a capitalized method on the `models` and `db`
namespaces. This is the style used by [apps](/docs/apps/overview):

```ts
import {models, db} from '@getcronit/pylon-db'

@models.model()
class User extends models.Model {
  static objects = db.manager(User)
  id = models.ID()
  email = models.Text({unique: true})
  createdAt = models.CreatedAt()
}
```

The two styles are equivalent — pick one per project. Next, connect models
together with [relations](/docs/data/relations).
