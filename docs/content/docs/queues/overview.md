---
title: Background Jobs
nav: Overview
description: Typed queues, cron schedules, and a transactional outbox for exactly-once enqueue-iff-commit.
section: Background Jobs
order: 0
---

Some work doesn't belong in the request path — sending email, generating reports,
syncing a third party. `@getcronit/pylon-queues` gives you **typed background jobs**:
a queue is parameterized by its payload and its result, so enqueuing the wrong
shape is a compile error. Add a transactional outbox and you get **exactly-once
enqueue-iff-commit** — a job is enqueued only when the database transaction that
created it commits.

## Define a queue

A queue is typed by its payload `T` and the result `R` its processor returns.
Attach a zod `schema` to validate payloads at the boundary, plus retry and
concurrency options:

```ts title="src/queues.ts"
import {defineQueue} from '@getcronit/pylon-queues'
import {z} from 'zod'

export const sendEmail = defineQueue('send-email', {
  schema: z.object({to: z.string().email(), subject: z.string()}),
  attempts: 3,
  backoff: {type: 'exponential', delay: 1000},
  concurrency: 5,
  removeOnComplete: true
})
```

`QueueOptions`:

| Option | Meaning |
|---|---|
| `schema` | Validates the payload before it's enqueued |
| `attempts` | Max attempts before a job is failed |
| `backoff` | `{type: 'exponential' \| 'fixed', delay}` between attempts |
| `concurrency` | Jobs processed in parallel per worker |
| `removeOnComplete` / `removeOnFail` | Prune finished jobs |

## Process jobs

Register a processor with `.process()`. The handler receives the validated `data`,
the raw `job`, and a `log` helper for structured progress logging:

```ts title="src/queues.ts"
sendEmail.process(async ({data, job, log}) => {
  await log(`attempt ${job.attemptsMade + 1} → ${data.to}`)
  await mailer.send(data.to, data.subject)
})
```

`.process()` only **registers** the handler — it's safe to call wherever your
module is imported. Workers start consuming separately, in the `pylon worker`
process.

## Enqueue jobs

Add jobs from anywhere — a resolver, a route, another job:

```ts
import {Pylon} from '@getcronit/pylon'
import {sendEmail} from './src/queues'

export default new Pylon({
  graphql: {
    Mutation: {
      invite: async (to: string) => {
        await sendEmail.add({to, subject: 'You are invited'})
        return true
      }
    }
  }
})
```

- `.add(data, opts?)` — enqueue immediately.
- `.addDelayed(data, ms, opts?)` — enqueue after a delay.
- `.dispatch(data, opts?): Promise<R>` — enqueue **and await** the processor's
  typed result, for request/response over a worker:

```ts
const result = await reportQueue.dispatch({month: '2026-06'})
//    ^? the processor's return type R
```

## Cron jobs

Schedule repeatable work with a cron pattern. `cron` registers a queue and its
processor in one call:

```ts title="src/queues.ts"
import {cron} from '@getcronit/pylon-queues'

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
import {useQueues} from '@getcronit/pylon-queues'

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

When `@getcronit/pylon-db` is present, each job runs inside the database context,
so your models, [policies](/docs/data/policies), and tenant scoping apply inside
processors exactly as they do in resolvers.

## Run workers in production

In production, run a dedicated worker process. The worker entry imports your app
to register the queues, then starts the workers and drains the outbox:

```ts title="src/worker.ts"
import {startWorkers, runOutboxRelay} from '@getcronit/pylon-queues'
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
import {getDatabase} from '@getcronit/pylon-db'
import {sendEmail} from './src/queues'

await getDatabase().transaction(async () => {
  await createOrder(...)
  await sendEmail.add({to: customer.email, subject: 'Order confirmed'})
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
