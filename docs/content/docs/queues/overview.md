---
title: Queues
description: Typed background jobs, cron schedules, and a transactional outbox — backed by BullMQ and Redis.
section: Production
order: 0
nav: Queues
---

`@getcronit/pylon-queues` adds background processing to Pylon: typed job queues,
cron schedules, and a transactional outbox that guarantees jobs are only
enqueued when the database transaction that created them commits. It's built on
[BullMQ](https://docs.bullmq.io) and Redis.

## Define a queue

A queue is typed by its payload. Attach a validation `schema` and retry options:

```ts
import {defineQueue} from '@getcronit/pylon-queues'
import {z} from 'zod'

export const emailSend = defineQueue('email-send', {
  schema: z.object({to: z.string().email(), subject: z.string()}),
  attempts: 3,
  backoff: {type: 'exponential', delay: 1000},
  concurrency: 5
})
```

## Process jobs

Register a processor with `.process()`. The handler receives the validated
`data`, the raw `job`, and a `log` helper:

```ts
emailSend.process(async ({data, log}) => {
  await log(`sending to ${data.to}`)
  await sendEmail(data.to, data.subject)
})
```

`process()` only registers the handler — it's safe to call when your app module
is imported in any process. Workers start consuming separately (see below).

## Enqueue jobs

Add jobs from anywhere — a resolver, another job:

```ts
await emailSend.add({to: 'user@example.com', subject: 'Welcome'})
await emailSend.addDelayed({to: 'user@example.com', subject: 'Reminder'}, 60_000)
```

## Cron jobs

Schedule repeatable work with a cron pattern:

```ts
import {cron} from '@getcronit/pylon-queues'

cron('nightly-cleanup', '0 0 * * *', async () => {
  await purgeExpired()
})
```

## Wiring it up

Add the plugin to bind Redis and (optionally) run workers in-process during
development:

```ts
import {useQueues} from '@getcronit/pylon-queues'

export default {
  plugins: [
    useQueues({
      connection: process.env.REDIS_URL,
      worker: 'in-process' // dev convenience; use a separate worker in production
    })
  ]
}
```

When `pylon-db` is present, each job runs inside `getDatabase().run(...)`, so your
models, policies, and tenant scoping work inside processors just like in
resolvers.

## Running workers in production

In production, run workers as a separate process. A worker entry imports your app
(to register queues), then starts the workers and the outbox relay:

```ts
// src/worker.ts
import {startWorkers, runOutboxRelay} from '@getcronit/pylon-queues'
import './index.js' // side-effect: registers queues and processors

await startWorkers()
runOutboxRelay()
```

```bash
pylon worker         # bundles and runs src/worker.ts
```

## Transactional outbox

The hardest part of background jobs is consistency: if you enqueue a job and the
surrounding database transaction then rolls back, you've created a phantom job.
Pylon's outbox solves this. When `useQueues` is configured with the outbox
(default when `pylon-db` is installed), `queue.add()` inside a transaction writes
the job to an outbox table instead of Redis. A relay process moves committed rows
to Redis afterward:

```ts
import {createPgOutbox, setOutboxDriver, relayOnce} from '@getcronit/pylon-queues'

setOutboxDriver(await createPgOutbox())

await db.transaction(async () => {
  await emailSend.add({to: 'a@b.co', subject: 'Hi'})
  // if this transaction rolls back, no job is ever enqueued
})

await relayOnce() // drain committed rows into Redis (or use runOutboxRelay())
```

This gives you exactly-once enqueue semantics tied to your business transaction —
jobs and data commit together, or not at all.
