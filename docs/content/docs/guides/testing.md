---
title: Testing
description: Test your Pylon API by sending requests straight to the app — no network required.
section: Guides
order: 1
---

Pylon gives you two fast levels to test at: your **resolvers** (plain functions)
and your **data layer** (the ORM, standalone). Both run without a network.

## Resolvers are plain functions

Because the members of `graphql` are ordinary TypeScript functions, the simplest
test imports and calls them. Keep your resolvers in a module so they're easy to
reach from both your `Pylon` instance and your tests:

```ts title="src/resolvers.ts"
import {Post} from './models.js'

export const Query = {
  posts: (): Promise<Post[]> => Post.objects.orderBy('-createdAt').all(),
  post: (id: number): Promise<Post> => Post.objects.get({id})
}
```

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {Query} from './resolvers.js'

export default new Pylon({graphql: {Query, Mutation: {}}})
```

```ts title="resolvers.test.ts"
import {expect, test} from 'vitest'
import {Query} from './src/resolvers.js'

test('lists posts newest-first', async () => {
  const posts = await Query.posts()
  expect(posts[0].createdAt >= posts[1].createdAt).toBe(true)
})
```

## End-to-end over HTTP

A `Pylon` extends Hono, so once the app has booted its config you can drive it
with `app.request()` — no server needs to be listening. Run these against the
built app (`pylon build` wires the GraphQL handler), or a running instance from
your [serving plugin](/docs/deployment/runtimes):

```ts
const res = await app.request('/graphql', {
  method: 'POST',
  headers: {'content-type': 'application/json', 'x-user-id': '42'},
  body: JSON.stringify({query: `{ me { id } }`})
})
expect(res.status).toBe(200)
```

Headers go through exactly as a client would send them — handy for exercising
[identity](/docs/authentication/overview), tenancy, and anything your resolvers
read from context.

## Testing the database layer

The ORM can be exercised directly, without GraphQL, by binding a database and
running your code inside it:

```ts
import {connect} from '@getcronit/pylon-db'
import {Post} from './src/models.js'

const db = connect({connectionString: process.env.DATABASE_URL})

await db.run(async () => {
  const post = await Post.objects.create({title: 'Hello', body: '...'})
  expect(post.id).toBeTypeOf('number')
})

await db.destroy()
```

Wrap assertions in `db.transaction(...)` and let it roll back to keep tests
isolated without truncating tables between runs.
