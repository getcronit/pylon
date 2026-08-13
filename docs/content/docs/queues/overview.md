---
title: Background Jobs
nav: Overview
description: Typed queues, cron schedules, and a transactional outbox for exactly-once enqueue-iff-commit.
section: Background Jobs
order: 0
---

Some work doesn't belong in the request path — sending email, generating reports,
syncing a third party. `@getcronit/pylon/queues` gives you **typed background jobs**:
a queue is a class typed by its payload, so enqueuing the wrong shape is a compile
error and a schema can validate it at runtime too. Add a transactional outbox and
you get **exactly-once enqueue-iff-commit** — a job is enqueued only when the
database transaction that created it commits.

## Define a queue

A queue is a class. Subclass `Queue`, type its payload, and write a `process`
handler — the same shape as a model's `process`/`objects` pairing. Put per-queue
options in a `static config`, expose a typed enqueue manager on a static (exactly
as a model exposes `static objects = manager(X)`), then register the class on your
app by passing it to `queues` on the `Pylon` constructor:

```ts title="src/queues.ts"
import {Queue, manager, type QueueConfig} from '@getcronit/pylon/queues'

export class SendWelcome extends Queue<{userId: string}> {
  static config = {attempts: 3} satisfies QueueConfig<SendWelcome>
  static jobs = manager(SendWelcome)

  async process({data}) {
    // data.userId is typed
  }
}
```

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {SendWelcome} from './queues'

export default new Pylon({name: 'blog', queues: [SendWelcome]})
```

Registering a queue on a named app namespaces the queue name by the app —
kebab-casing the class name, so `SendWelcome` on `blog` becomes
`blog:send-welcome`. An un-named app leaves the queue name unprefixed.

`manager(QueueClass)` returns the typed enqueue manager. Assign it to a static
(`static jobs = manager(SendWelcome)`) for the same reason a model needs
`static objects = manager(X)`: TypeScript can't infer an inherited static, so you
re-state the binding once.

`QueueConfig`:

| Option | Meaning |
|---|---|
| `attempts` | Max attempts before a job is failed |
| `backoff` | `{type: 'exponential' \| 'fixed', delay}` between attempts |
| `concurrency` | Jobs processed in parallel per worker |
| `removeOnComplete` / `removeOnFail` | Prune finished jobs |
| `schema` | Validates the payload before it's enqueued (see below) |
| `name` / `cron` | Override the queue name; schedule on a cron pattern |

## Validate the payload — schema-first

The bare `Queue<Payload>` generic is type-only: it shapes the payload at compile
time and nothing more. For anything that crosses the wire, define the payload from
a schema with `Queue.input(schema)`. The schema becomes the single source of
truth — the payload type is **inferred from it**, and it **validates every job at
runtime**:

```ts title="src/queues.ts"
import {z} from 'zod'
import {Queue, manager, type QueueConfig} from '@getcronit/pylon/queues'

export class SendWelcome extends Queue.input(z.object({userId: z.string()})) {
  static config = {attempts: 3} satisfies QueueConfig<SendWelcome>
  static jobs = manager(SendWelcome)

  async process({data}) {
    // data: {userId: string}, already validated
  }
}
```

:::warning[Validate at the queue boundary]
A queue boundary is a wire boundary. A job payload is serialized into Redis and
pulled back out later by a **separate worker process** — possibly running a
different version of your code. By the time the worker calls `process`, the
compile-time type has been erased; nothing structural survives the round trip. The
schema is what guards that boundary, so a malformed or stale payload fails loudly
at the edge instead of corrupting your handler.
:::

:::tip
Use `Queue.input(schema)` for any queue whose jobs originate from user input or
another service. Reach for the bare `Queue<Payload>` generic only for trivial,
internal queues where you accept no runtime validation. An explicit `{schema}`
option overrides a schema attached via `Queue.input`.
:::

## Process jobs

The `process` method is the handler. It receives the validated `data` (plus the
raw `job` and a `log` helper for structured progress). Defining the method only
declares the handler — workers start consuming separately, in the `pylon worker`
process:

```ts title="src/queues.ts"
export class SendEmail extends Queue.input(
  z.object({to: z.string().email(), subject: z.string()})
) {
  static config = {attempts: 3} satisfies QueueConfig<SendEmail>
  static jobs = manager(SendEmail)

  async process({data, job, log}) {
    await log(`attempt ${job.attemptsMade + 1} → ${data.to}`)
    await mailer.send(data.to, data.subject)
  }
}
```

## Enqueue jobs

Enqueue through the static manager from anywhere — a resolver, a route, another
job:

```ts
import {Pylon} from '@getcronit/pylon'
import {SendEmail} from './src/queues'

export default new Pylon({
  graphql: {
    Mutation: {
      invite: async (to: string) => {
        await SendEmail.jobs.add({to, subject: 'You are invited'})
        return true
      }
    }
  }
})
```

The manager exposes three typed methods:

- `.add(data)` — fire-and-forget enqueue. Inside a pylon-db transaction it's
  routed through the outbox (enqueue-iff-commit, see below).
- `.addDelayed(data, ms)` — enqueue after a delay.
- `.dispatch(data)` — enqueue **and await** the handler's typed result, for
  request/response over a worker:

```ts
const result = await GenerateReport.jobs.dispatch({month: '2026-06'})
//    ^? the value process() resolves to
```

## Cron jobs

Schedule repeatable work with a cron pattern via the `cron` option — no payload
needed:

```ts title="src/queues.ts"
export class Heartbeat extends Queue {
  static config = {cron: '0 * * * *'} satisfies QueueConfig<Heartbeat>
  async process() {
    await pingMonitoring()
  }
}
```

## Lower-level alternatives

The class form is the recommended surface, but the function-style API remains
valid and is occasionally handier for one-off or dynamically named queues.

`defineQueue<T, R>(name, options)` creates a queue typed by payload `T` and result
`R`; `.process()` registers its handler:

```ts title="src/queues.ts"
import {defineQueue} from '@getcronit/pylon/queues'
import {z} from 'zod'

export const sendEmail = defineQueue('send-email', {
  schema: z.object({to: z.string().email(), subject: z.string()}),
  attempts: 3,
  backoff: {type: 'exponential', delay: 1000},
  concurrency: 5
})

sendEmail.process(async ({data, job, log}) => {
  await log(`attempt ${job.attemptsMade + 1} → ${data.to}`)
  await mailer.send(data.to, data.subject)
})
```

`cron(name, pattern, handler)` registers a scheduled queue and its handler in one
call:

```ts title="src/queues.ts"
import {cron} from '@getcronit/pylon/queues'

cron('nightly-cleanup', '0 0 * * *', async ({log}) => {
  await log('purging expired sessions')
  await purgeExpired()
})
```

## Wire it up

Enable queues with the `useQueues` plugin in `pylon.config.ts`. In development,
`worker: 'in-process'` runs the workers inside the app so you don't need a second
process:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {useQueues} from '@getcronit/pylon/queues/plugin'

export default {
  plugins: [
    useQueues({
      connection: process.env.REDIS_URL,
      outbox: true,
      worker: 'in-process' // dev only — production uses `pylon worker`
    })
  ]
} satisfies PylonConfig
```

When `@getcronit/pylon/db` is present, each job runs inside the database context,
so your models, [policies](/docs/data/policies), and tenant scoping apply inside
processors exactly as they do in resolvers.

`outbox: true` installs the Postgres-backed outbox driver — `createPgOutbox()`,
which creates its table on first use — via `setOutboxDriver`. Outside the plugin
(a custom entry, a test) you can wire it yourself:

```ts
import {setOutboxDriver, createPgOutbox} from '@getcronit/pylon/queues'

setOutboxDriver(await createPgOutbox())
```

## Run workers in production

In production, run a dedicated worker process. The worker entry imports your app
to register the queues, then starts the workers and drains the outbox:

```ts title="src/worker.ts"
import {startWorkers, runOutboxRelay} from '@getcronit/pylon/queues'
import './index.js' // side-effect: registers queues, processors, and crons

await startWorkers()
runOutboxRelay()
```

```bash
pylon worker   # bundles and runs ./src/worker.ts
```

Run it alongside your app — same image, different command. See
[deployment](/docs/production/deployment).

## Transactional outbox

The hardest part of background jobs is consistency. Enqueue a job, then have the
surrounding transaction roll back, and you've created a phantom job that fires
against data that was never written. The outbox closes that gap.

With `outbox: true`, calling `.add()` **inside a pylon-db transaction** writes the
job to an outbox table in the *same* transaction instead of pushing to the queue.
A relay then drains only committed rows to the queue:

```ts
import {getDatabase} from '@getcronit/pylon/db'
import {SendEmail} from './src/queues'

await getDatabase().transaction(async () => {
  await createOrder(...)
  await SendEmail.jobs.add({to: customer.email, subject: 'Order confirmed'})
  // if this transaction rolls back, the job is never enqueued
})
```

The relay (`runOutboxRelay()`, started by the worker) moves committed outbox rows
to the queue. The job and the data commit together, or not at all —
**exactly-once enqueue-iff-commit**.

:::tip
The outbox composes with [signals](/docs/data/signals): emit a signal on commit
and let a queue do the slow work, keeping write transactions short.
:::

:::warning
Enqueue-iff-commit only applies to `.add()` calls made *inside* a database
transaction. Calls outside a transaction enqueue immediately, as expected.
:::

:::tip[Related guide]
Build a reliable signup-email pipeline in [Background Jobs](/docs/guides/background-jobs).
:::
