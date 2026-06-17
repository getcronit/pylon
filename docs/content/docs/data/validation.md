---
title: Validation
description: Validate data before it is written — built-in rules, custom functions, and Standard Schema integration.
section: Data — pylon-db
order: 4
---

Validation runs **before** every insert and update. Invalid data never reaches
the database, and numeric and enum rules are also projected to SQL `CHECK`
constraints as defense-in-depth.

## Built-in rules

Declare rules as field options:

```ts
import {Model, manager, id, text, int} from '@getcronit/pylon-db'

@model()
class User extends Model {
  static objects = manager(User)
  id = id()
  email = text({email: true, max: 255})
  age = int({min: 0, max: 130})
  handle = text({pattern: /^[a-z0-9_]+$/, min: 3})
}
```

Available options: `min`, `max` (value for numbers, length for strings),
`pattern`, `email`, plus `unique` (enforced by the database and surfaced as a
validation error).

## Custom validation

Pass a `validate` function that returns `true` on success or a message on
failure:

```ts
text({
  validate: value => (value.includes('@') ? true : 'Must contain an @')
})
```

## Standard Schema

Any [Standard Schema](https://standardschema.dev) validator — Zod, Valibot,
ArkType — can be attached with `schema`. Pylon reads the standard interface, so
the library is never imported by the ORM:

```ts
import {z} from 'zod'

@model()
class User extends Model {
  static objects = manager(User)
  id = id()
  email = text({
    schema: z.string().email().transform(s => s.toLowerCase())
  })
}
```

## Handling validation errors

A failed write throws a `ValidationError` carrying structured issues:

```ts
import {ValidationError} from '@getcronit/pylon-db'

try {
  await User.objects.create({email: 'nope', age: -5})
} catch (err) {
  if (err instanceof ValidationError) {
    err.issues // [{path: 'email', code: 'email', message: '...'}, {path: 'age', code: 'min', ...}]
  }
}
```

Each issue has a `path` (the property), a `code`
(`required`, `type`, `min`, `max`, `length`, `pattern`, `email`, `enum`,
`unique`, or `custom`), an optional `params` object, and a default English
`message`.

When you use the [`useDatabase`](/docs/data/models) plugin, these errors are
mapped automatically to client-safe GraphQL errors — and when returned from a
[`mutation()`](/docs/core-concepts/errors), they become Shopify-style
`userErrors` with the field path attached.
