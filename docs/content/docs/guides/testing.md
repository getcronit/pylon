---
title: Testing
description: Unit-test resolvers and services directly, integration-test against real Postgres, and end-to-end against a built app.
section: Guides
order: 8
---

A Pylon app is plain TypeScript, so most of it tests like any other code — call a
function, assert on the result. Three layers cover the surface: **unit** tests for
resolvers and services in isolation, **integration** tests against a real Postgres
database, and **end-to-end** tests that build the app and issue GraphQL or HTTP
requests. The examples use Vitest, but nothing here is framework-specific.

## Unit-test resolvers and services

Resolvers are functions. Pull the resolver logic into a service, then call it
directly — no server, no GraphQL transport.

```ts title="src/services/tasks.ts"
import {Task} from '../models.js'

export async function completeTask(id: number): Promise<Task> {
  const task = await Task.objects.get({id})
  task.done = true
  await task.$save()
  return task
}
```

```ts title="src/services/tasks.test.ts"
import {expect, test} from 'vitest'
import {runAsSystem} from '@getcronit/pylon/db'
import {Task} from '../models.js'
import {completeTask} from './tasks.js'

test('completeTask marks a task done', async () => {
  await runAsSystem(async () => {
    const task = await Task.objects.create({title: 'write tests'})
    const done = await completeTask(task.id)
    expect(done.done).toBe(true)
  })
})
```

`runAsSystem` runs the body with full access and no request context, so it
bypasses tenant scoping and abilities — exactly what you want for setup that
shouldn't be subject to per-request authorization. See
[Authorization](/docs/data/policies).

## Integration-test against real Postgres

Pylon's ORM talks to Postgres, so test against Postgres — not a mock. Spin up a
disposable database, point `DATABASE_URL` at it, and sync your models with
`pylon db push` before the suite runs.

```bash
# in CI, or via a docker-compose service
export DATABASE_URL=postgres://localhost/tracker_test
pylon db push   # apply current models to the test DB (no migration recorded)
```

:::tip
`pylon db push` is ideal for tests — it syncs the live models directly, so the
test schema always matches the code under test without maintaining migration
fixtures. Reserve `pylon db migrate` for tests that specifically verify migration
behavior.
:::

For tenant-scoped models, set up fixtures with `unscoped()` so a missing tenant
binding doesn't throw, and assert that a *scoped* read sees only its own org:

```ts title="src/tasks.integration.test.ts"
import {beforeEach, expect, test} from 'vitest'
import {Task} from './models.js'
import {runAsSystem, runWithAppContext} from '@getcronit/pylon/db'

beforeEach(async () => {
  await runAsSystem(async () => {
    await Task.objects.unscoped().delete() // reset
    await Task.objects.unscoped().createMany([
      {orgId: 'org-A', title: 'a1'},
      {orgId: 'org-B', title: 'b1'}
    ])
  })
})

test('a request only sees its own tenant', async () => {
  await runWithAppContext({tenant: 'org-A'}, async () => {
    const tasks = await Task.objects.all()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('a1')
  })
})
```

`runWithAppContext` binds a tenant (and optionally `principal` and `features`)
around a block, simulating what `useDatabase` does per request. See
[Multi-tenancy & Features](/docs/data/multi-tenancy).

## End-to-end against a built app

The highest-fidelity test boots the real app and talks to it over HTTP. Because a
`Pylon` extends Hono, you can drive it with `app.fetch` directly — no network
socket required.

```ts title="src/app.e2e.test.ts"
import {expect, test} from 'vitest'
import app from './index.js' // the default-exported Pylon instance

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await app.fetch(
    new Request('http://test/graphql', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-user-id': 'u1', 'x-org': 'org-A'},
      body: JSON.stringify({query, variables})
    })
  )
  return res.json() as Promise<{data?: any; errors?: any[]}>
}

test('addTask then tasks returns the new task', async () => {
  const created = await gql(
    `mutation ($title: String!) { addTask(title: $title) { id title } }`,
    {title: 'ship it'}
  )
  expect(created.errors).toBeUndefined()

  const {data} = await gql(`query { tasks { id title } }`)
  expect(data.tasks.map((t: any) => t.title)).toContain('ship it')
})
```

Passing the `x-user-id` / `x-org` headers exercises your identity provider, so the
request runs through the same tenant scoping and abilities as production. Plain
HTTP routes (health checks, webhooks) are tested the same way — `app.fetch` a
`Request` and assert on the `Response`.

:::note
`app.fetch` runs the GraphQL handler and your routes, but **not** a `'last'`-
strategy serve plugin — that only starts the listener. For e2e tests you don't
need a real port; fetch the app instance directly. To test against a built
artifact instead, run `pylon build` and import `./.pylon/index.js`.
:::

## A note on what to mock

Mock at the edges, not the middle. External services — a mail provider, a payment
API — are worth stubbing. The database is not: an in-memory fake drifts from real
Postgres behavior (constraints, `tsvector` search, relation batching) and gives
false confidence. Use a real test database and `runAsSystem`/`unscoped()` for
setup, and your tests exercise the same query path your users hit.

## Where to go next

- [Authorization](/docs/data/policies) — `runAsSystem`, `unscoped`, and the
  ability rules your tests verify.
- [Multi-tenancy & Features](/docs/data/multi-tenancy) — `runWithAppContext` and
  tenant scoping.
- [CLI reference](/docs/reference/cli) — `pylon db push`, `build`, and the
  migration commands.
