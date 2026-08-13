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
import {signals} from '@getcronit/pylon/db'
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
| `changes` | save signals, UPDATE only: the fields that changed, as `{key: {from, to}}` |

`$save()` / `$delete()` fire once with a one-element `instances` array;
`createMany` fires once with the whole batch.

### Field-level changes

On an UPDATE, a save payload carries `changes` — the columns whose value differs
from the baseline loaded from the DB — so a plain `postSave` receiver can write
audit diffs without re-reading the row:

```ts
signals.postSave.connect(Order, ({instances, created, changes}) => {
  if (created || !changes?.status) return
  const {from, to} = changes.status // { from: 'pending', to: 'shipped' }
  console.log(`order ${instances[0].id}: ${from} → ${to}`)
})
```

It's present only on single-instance `$save` updates: set-based
[`.update()`](/docs/data/queries#writes) never loads rows, a field set on a fresh
`new Model()` has no baseline to diff, and an **in-place** mutation of a JSON/object
field won't register — assign a new value so the change is seen.

## When signals fire

Signals run for instance writes and batch creates:

- `$save()` → `preSave` then `postSave` (`created` reflects insert vs update)
- `$delete()` → `preDelete` then `postDelete`
- `createMany()` → one `preSave` / `postSave` over the batch

`postSave` receivers see DB-generated values (defaults, identities) reflected on
the instances.

:::note
Set-based [`.update()` / `.delete()`](/docs/data/queries#writes) fire **post**
signals by default — the rows are captured via `RETURNING`, hydrated, and handed to
`postSave(created: false)` / `postDelete`. Only the **pre** hooks are skipped (a
single statement has no per-row before-phase), and set-based UPDATE carries no
`changes` diff. Pass `{signals: false}` to opt a large bulk op out; use `$save()` /
`$delete()` when a **pre** hook must run per row.
:::

Skip signals for a specific batch — seeds, imports — with `{signals: false}`:

```ts
await User.objects.createMany(rows, {signals: false})
```

## Transactions, veto, and `afterCommit`

By default a receiver runs **inside the write's transaction**. Two consequences:

- **A `preSave` / `preDelete` receiver that throws vetoes the write** — the
  transaction rolls back. This makes pre-signals a validation gate: throw to reject.
- **A receiver's own ORM writes are atomic** with the triggering write — an audit
  row written from `postSave` commits or rolls back together with it.

```ts
// reject the write from a pre-signal
signals.preSave.connect(Account, ({instances}) => {
  for (const a of instances) {
    if (a.balance < 0) throw new Error('balance cannot go negative') // rolls back
  }
})
```

For side effects that must **not** run on rollback and must **never** break the
write — realtime pokes, cache invalidation, webhooks, external notifications —
connect with `{afterCommit: true}`. The receiver is deferred until after the
transaction commits and runs outside it, so its errors are isolated:

```ts
signals.postSave.connect(
  Order,
  ({instances}) => invalidateCache(instances.map(o => o.id)),
  {afterCommit: true}
)
```

## Enqueue work from a signal

Because receivers run inside the transaction, they pair with the
[queues outbox](/docs/queues/overview) for exactly-once enqueue-iff-commit:
emit a job from a `postSave` hook, and it's enqueued only when the surrounding
transaction commits.

```ts
import {signals} from '@getcronit/pylon/db'
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
