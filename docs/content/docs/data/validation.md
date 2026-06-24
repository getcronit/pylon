---
title: Validation
nav: Validation
description: Field rules that run before every write, project into DB CHECK constraints, and surface as structured client errors.
section: Data — pylon-db
order: 4
---

Validation lives on the field. The rules you attach to a builder run **before
the database write** — on `$save()`, `create`, and `createMany` — and a throwing
rule aborts the write. A subset of those rules is also projected into a Postgres
`CHECK` constraint, so the database enforces the same invariant against raw SQL
and non-ORM writers. **The check is declared once and enforced in two places.**

## Field rules

Every field builder accepts the validation options below. They compose — a field
can have several:

```ts title="src/models.ts"
import {Model, manager, id, text, int} from '@getcronit/pylon-db'

@model()
class User extends Model {
  static objects = manager(User)

  id = id()
  email = text({email: true})
  username = text({min: 3, max: 32, pattern: /^[a-z0-9_]+$/})
  age = int({min: 0, max: 130})
  bio = text({nullable: true, max: 280, validate: v =>
    String(v).includes('http') ? 'No links in bio' : true})
}
```

| Option | Rule |
| --- | --- |
| `min` | minimum value (numbers) or length (strings) |
| `max` | maximum value (numbers) or length (strings) |
| `email` | must be a valid email address |
| `pattern` | string must match the `RegExp` |
| `validate` | custom rule: return `true` or an error message |
| `schema` | a Standard Schema (Zod / Valibot / ArkType) |

## Standard Schema

Pass any [Standard Schema](https://standardschema.dev) validator via `{schema}`.
The ORM never imports the validation library — it reads the standard
`~standard` interface, so the library owns the error message:

```ts
import {z} from 'zod'

@model()
class Product extends Model {
  static objects = manager(Product)
  id = id()
  sku = text({schema: z.string().regex(/^[A-Z]{3}-\d{4}$/)})
  price = numeric({precision: 10, scale: 2, schema: z.number().positive()})
}
```

## The error shape

A failed write throws a structured `ValidationError`. Its `issues` array carries
a machine-readable `code`, the `path` (the field), constraint `params` for
translation, and a default English `message`:

```ts
import {ValidationError} from '@getcronit/pylon-db'

try {
  await User.objects.create({email: 'nope', age: 200})
} catch (e) {
  if (e instanceof ValidationError) {
    console.log(e.issues)
    // [
    //   {path: 'email', code: 'email', message: 'Must be a valid email'},
    //   {path: 'age',   code: 'max', params: {max: 130}, message: '...'}
    // ]
  }
}
```

`code` is one of `required`, `type`, `min`, `max`, `length`, `pattern`, `email`,
`enum`, `unique`, or `custom`.

## Surfacing to clients

`useDatabase` maps a thrown `ValidationError` to a client-safe GraphQL
`BAD_USER_INPUT` error carrying the structured issues — so a resolver doesn't
need a `try/catch`, and the client gets a typed, actionable response. Customize
or disable the mapping:

```ts title="pylon.config.ts"
import {useDatabase} from '@getcronit/pylon-db'

export default {
  plugins: [
    useDatabase({
      // localize from `code` + `params` using the request locale, or pass
      // `false` to leave the error masked.
      validationErrors: (error, ctx) => translate(error.issues, ctx)
    })
  ]
}
```

## What reaches the database

Numeric bounds, string-length bounds, and enum membership are projected into a
column `CHECK` — the database backs up the same rule:

:::generates
```ts title="You write"
@model()
class User extends Model {
  age = int({min: 0, max: 130})
}
```

```sql title="Pylon generates"
"age" integer NOT NULL CHECK ("age" >= 0 AND "age" <= 130)
```
:::

:::note
`pattern` and `email` are **not** projected to a `CHECK` — a JavaScript `RegExp`
doesn't translate faithfully to Postgres POSIX regex, so they stay JS-only to
avoid the app and database disagreeing. The structured `ValidationError` still
enforces them on every ORM write.
:::
