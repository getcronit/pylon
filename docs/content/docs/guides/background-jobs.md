---
title: Background Jobs
nav: Background Jobs
description: Send a welcome email reliably — a typed queue enqueued from a signal hook, so the job fires only if the signup commits.
section: Guides
order: 5
---

Sending email in the request path is slow and fragile — the SMTP call blocks the
response, and a retry might double-send. This guide moves it off the request path
and makes it reliable: when a `User` row commits, a welcome email is enqueued
**exactly once**. The trick is enqueuing from a `postSave` signal inside the write
transaction, so the outbox guarantees enqueue-iff-commit — no phantom jobs against
rows that rolled back.

## 1. Define the queue

A queue is a class typed by its payload, with a `process` handler and a static
enqueue manager — the same shape as a model's `static objects = manager(X)`.
Define the payload from a zod schema with `Queue.input(schema)`: the schema is the
single source of truth, inferring the payload type **and** validating every job at
runtime. That matters here because the job is serialized into Redis and pulled back
out by a separate worker process — the compile-time type is gone by then, so the
schema is what guards the boundary:

```ts title="src/queues.ts"
import {Pylon} from '@getcronit/pylon'
import {Queue, enqueuer} from '@getcronit/pylon-queues'
import {z} from 'zod'

const app = new Pylon({name: 'app'})

@app.queue({attempts: 3, backoff: {type: 'exponential', delay: 1000}})
class SendWelcome extends Queue.input(
  z.object({userId: z.string(), email: z.string().email()})
) {
  static jobs = enqueuer(SendWelcome)

  async process({data, job, log}) {
    await log(`attempt ${job.attemptsMade + 1} → ${data.email}`)
    await mailer.send({
      to: data.email,
      subject: 'Welcome aboard',
      body: 'Glad to have you.'
    })
  }
}
```

`attempts` and `backoff` make the email survive a flaky mail provider — three
tries with exponential backoff before the job is failed. Defining `process` only
declares the handler; workers consume it separately. `enqueuer(SendWelcome)`
exposes the typed enqueue manager on `SendWelcome.jobs`.

## 2. Enqueue from a signal — transactionally

Rather than enqueue from the signup resolver, connect a `postSave` receiver to the
`User` model. Signals fire **inside the write transaction**, so the `.add()` lands
in the outbox in the same transaction as the row. If the signup rolls back, the
email is never enqueued:

```ts title="src/signals.ts"
import {signals} from '@getcronit/pylon-db'
import {User} from './models'
import {SendWelcome} from './queues'

signals.postSave.connect(User, async ({instances, created}) => {
  if (!created) return // only on insert, not update
  for (const user of instances) {
    // queued iff the surrounding transaction commits
    await SendWelcome.jobs.add({userId: String(user.id), email: user.email})
  }
})
```

The signup resolver itself stays minimal — it just writes the user. The email is a
consequence of the commit, not a separate step the resolver has to remember:

```ts title="src/index.ts"
import {Pylon} from '@getcronit/pylon'
import {User} from './models'

export default new Pylon({
  graphql: {
    Mutation: {
      signUp: async (email: string, name: string) => {
        const user = new User()
        user.email = email
        user.name = name
        await user.$save() // postSave fires → SendWelcome enqueued in the outbox
        return user
      }
    }
  }
})
```

## 3. Wire up queues

Enable queues with the `useQueues` plugin. Turn the outbox on for
enqueue-iff-commit; in development, `worker: 'in-process'` runs the workers inside
the app so you don't need a second process:

```ts title="pylon.config.ts"
import type {PylonConfig} from '@getcronit/pylon'
import {useDatabase} from '@getcronit/pylon-db'
import {useQueues} from '@getcronit/pylon-queues'

export default {
  plugins: [
    useDatabase(),
    useQueues({
      connection: process.env.REDIS_URL,
      outbox: true,
      worker: 'in-process' // dev only — production uses `pylon worker`
    })
  ]
} satisfies PylonConfig
```

With the queues plugin, importing `./src/signals` and `./src/queues` somewhere in
your app's module graph is enough to register the receiver and the processor.

## 4. Run workers in production

In production, run a dedicated worker process. The worker entry imports your app to
register the queues, then starts the workers and drains the outbox:

```ts title="src/worker.ts"
import {startWorkers, runOutboxRelay} from '@getcronit/pylon-queues'
import './index.js' // side-effect: registers queues, processors, and signals

await startWorkers()
runOutboxRelay()
```

```bash
pylon worker   # bundles and runs ./src/worker.ts
```

`runOutboxRelay()` moves committed outbox rows to the queue. The user row and the
job commit together, or not at all — **exactly-once enqueue-iff-commit**.

:::tip
This keeps the write transaction short: the `postSave` hook only records intent
(`add` to the outbox), and the queue does the slow SMTP work outside the
transaction.
:::

:::warning
Enqueue-iff-commit only applies to `.add()` calls made *inside* a database
transaction — which is exactly where a signal receiver runs. Calls outside a
transaction enqueue immediately, as expected.
:::

The signal lifecycle is detailed in [Lifecycle Signals](/docs/data/signals); the
queue surface — `dispatch`, `cron`, and outbox internals — is in
[Background Jobs](/docs/queues/overview).
