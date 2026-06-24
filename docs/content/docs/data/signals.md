---
title: Lifecycle Signals
nav: Signals
description: Django-style pre/post save and delete hooks that fire inside the write transaction — throw to roll back.
section: Data — pylon-db
order: 5
---

Signals are lifecycle hooks. You connect a receiver to `preSave`, `postSave`,
`preDelete`, or `postDelete`, and it runs whenever an instance is written or
deleted — to keep a denormalized count current, stamp an audit log, or enqueue a
job. Receivers fire **inside the write transaction**, so a throwing hook rolls
the whole write back: the side effect and the data commit together, or not at
all.

## Connecting a receiver

`signals.<event>.connect()` registers a receiver. Pass a model to scope it (and
get typed `instances`), or omit the model to receive every model's writes. It
returns a disconnect function:

```ts title="src/signals.ts"
import {signals} from '@getcronit/pylon-db'
import {AuditLog} from './models'

// scoped to one model — `instances` is typed `User[]`
signals.postSave.connect(User, async ({instances, created}) => {
  if (!created) return
  await AuditLog.objects.createMany(
    instances.map(u => ({action: 'user.created', subjectId: String(u.id)}))
  )
})

// every model — `model` tells you which
const off = signals.postDelete.connect(({instances, model}) => {
  console.log(`deleted ${instances.length} ${model.name}`)
})
// off() to disconnect
```

## The payload

| Field | Meaning |
| --- | --- |
| `instances` | the affected instances (typed when you pass a model) |
| `created` | `true` on insert, `false` on update — save signals only |
| `model` | the model constructor, for global receivers |

`$save()` / `$delete()` fire once with a one-element `instances` array;
`createMany` fires once with the whole batch.

## When signals fire

Signals run for instance writes and batch creates:

- `$save()` → `preSave` then `postSave` (`created` reflects insert vs update)
- `$delete()` → `preDelete` then `postDelete`
- `createMany()` → one `preSave` / `postSave` over the batch

`postSave` receivers see DB-generated values (defaults, identities) reflected on
the instances.

:::warning
Set-based [`.update()` / `.delete()`](/docs/data/queries#writes) run as a single
SQL statement and **never load instances**, so they do not fire signals — that's
the trade for their throughput. Use `$save()` / `$delete()` (or `createMany`)
when a hook must run per row.
:::

Skip signals for a specific batch — seeds, imports — with `{signals: false}`:

```ts
await User.objects.createMany(rows, {signals: false})
```

## Enqueue work from a signal

Because receivers run inside the transaction, they pair with the
[queues outbox](/docs/queues/overview) for exactly-once enqueue-iff-commit:
emit a job from a `postSave` hook, and it's enqueued only when the surrounding
transaction commits.

```ts
import {signals} from '@getcronit/pylon-db'
import {sendWelcome} from './queues'

signals.postSave.connect(User, async ({instances, created}) => {
  if (!created) return
  for (const user of instances) {
    await sendWelcome.add({userId: user.id}) // queued iff the tx commits
  }
})
```

This keeps the write transaction short — the hook records intent, the queue does
the slow work. See [Background Jobs](/docs/queues/overview) for the outbox.

:::tip[Related guide]
[Background Jobs](/docs/guides/background-jobs) builds a transactional signup-email pipeline using exactly this signal-to-queue pattern.
:::
