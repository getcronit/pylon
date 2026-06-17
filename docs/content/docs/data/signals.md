---
title: Signals
description: Lifecycle hooks that run on save and delete — for auditing, denormalization, and side effects, inside the same transaction.
section: Data — pylon-db
order: 6
---

Signals are lifecycle hooks that fire around writes. They're ideal for audit
logs, denormalized counters, and triggering side effects — and because they run
inside the same database transaction as the write, their effects commit or roll
back together with it.

## Available signals

| Signal | Fires |
| --- | --- |
| `signals.preSave` | before an insert or update (after validation) — throw to veto the write |
| `signals.postSave` | after an insert or update |
| `signals.preDelete` | before a delete |
| `signals.postDelete` | after a delete |

## Connecting a handler

Connect to a specific model for typed payloads, or omit the model to listen to
all of them. `connect` returns a disconnect function.

```ts
import {signals} from '@getcronit/pylon-db'

const off = signals.postSave.connect(Widget, ({instances, created}) => {
  // instances: Widget[]  — the rows written
  // created:   boolean   — true on insert, false on update
  for (const w of instances) {
    console.log(created ? 'created' : 'updated', w.name)
  }
})

// later
off()
```

Save payloads carry `{instances, created, model}`; delete payloads carry
`{instances, model}`.

## Auditing example

Because the handler runs in the write's transaction, an audit row is committed
atomically with the change — and discarded if the surrounding transaction rolls
back:

```ts
import {signals} from '@getcronit/pylon-db'
import {Activity, Author} from './models.js'

signals.postSave.connect(Author, ({instances, created}) =>
  Activity.objects.createMany(
    instances.map(a => ({
      action: created ? 'create' : 'update',
      target: a.name
    }))
  )
)
```

## Bulk writes fire once

`createMany` fires each signal **once** with the full array of instances, not
once per row:

```ts
signals.postSave.connect(Widget, ({instances}) => {
  console.log(`wrote ${instances.length} widgets`)
})

await Widget.objects.createMany([{name: 'a'}, {name: 'b'}, {name: 'c'}])
// → one postSave with instances.length === 3
```

Skip signals entirely for high-throughput seeding or imports:

```ts
await Widget.objects.createMany(rows, {signals: false})
```
