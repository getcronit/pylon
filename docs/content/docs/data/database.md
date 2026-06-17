---
title: Connecting a Database
description: Bind a PostgreSQL connection, run queries in context, and wrap work in transactions.
section: Data — pylon-db
order: 0
nav: Database & transactions
---

Pylon ORM talks to PostgreSQL. Inside a Pylon app you connect it with a plugin;
on its own (scripts, tests, jobs) you connect it directly. Either way, queries run
within a bound database context.

## In a Pylon app

Add the `useDatabase` plugin. It binds a connection for every request, wraps each
request in a transaction, and derives the principal and tenant from the bound
[identity](/docs/authentication/overview). In most apps it takes no arguments —
bind identity first, and `useDatabase()` reads the rest from the `Principal`:

```ts title="pylon.config.ts"
import {type PylonConfig} from '@getcronit/pylon'
import {useIdentity} from '@getcronit/pylon-auth'
import {useDatabase} from '@getcronit/pylon-db'
import {headerAuth} from './src/identity'

export default {
  plugins: [useIdentity(headerAuth), useDatabase()]
} satisfies PylonConfig
```

The connection comes from `DATABASE_URL` by default. Because each request runs in
a transaction, a request that throws rolls back every write it made — including
[signal](/docs/data/signals) side effects — so a partially applied mutation can't
leave inconsistent data behind.

## Standalone

Outside a request — a seed script, a test, a one-off job — connect explicitly and
run your code inside the database context:

```ts
import {connect} from '@getcronit/pylon-db'
import {User} from './models.js'

const db = connect({connectionString: process.env.DATABASE_URL})

await db.run(async () => {
  const users = await User.objects.all()
})

await db.destroy()
```

`db.run(fn)` binds the connection for the duration of `fn`, which is why your
managers (`User.objects.…`) know which database to use without you passing it
around.

## Transactions

Wrap related writes in a transaction so they commit or roll back together:

```ts
await db.transaction(async () => {
  const author = await Author.objects.create({name: 'Ada'})
  await Post.objects.create({title: 'Engines', authorId: author.id})
  // if anything throws, both inserts are rolled back
})
```

Transactions compose with everything else in the ORM: validation runs before
writes, [policies](/docs/data/policies) and [tenant scoping](/docs/data/multi-tenancy)
apply inside the transaction, and [signals](/docs/data/signals) fire within it —
so audit rows and denormalized counters commit atomically with the data that
triggered them.

:::tip
In tests, wrap each case in a transaction and let it roll back to keep cases
isolated without truncating tables between runs.
:::
