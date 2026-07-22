---
title: IDs & Global IDs
nav: IDs
description: Primary key strategies — bigint identity, cuid/uuid, and time-ordered snowflakes — plus opt-in Relay-style global object ids (gid).
section: Data — pylon-db
order: 2
---

Every model needs a primary key. `id()` gives you a database-allocated `bigint`
and is the right default. When you need **client-generated** ids — for
distributed writes, optimistic UI, or merge-friendly data — Pylon also ships
cuid, uuid, and time-ordered **snowflake** ids. On top of any of them you can opt
into **global ids** (`gid://…`): a single opaque handle per entity and a
universal `node(id)` refetch field.

## Primary key strategies

| Field | Column | Generated | Use it when |
| --- | --- | --- | --- |
| `id()` | `bigint` identity | by the database | the default — dense, sortable, compact |
| `id({snowflake: true})` | `text` | by the app (time-ordered) | multi-writer / distributed / you want the id before the insert returns |
| `text({primaryKey: true, default: createId})` | `text` | by the app (cuid-style) | you want a random, URL-safe id and don't care about ordering |
| `text({primaryKey: true, default: uuidv4})` | `text` | by the app (UUID v4) | you need a standard UUID |

```ts
import {Pylon} from '@getcronit/pylon'
import {Model, manager, id, text, createId, uuidv4} from '@getcronit/pylon-db'

class User extends Model {
  static objects = manager(User)
  id = id()                                              // bigint identity → number
}

class Event extends Model {
  static objects = manager(Event)
  id = id({snowflake: true})                             // time-ordered string
}

class Token extends Model {
  static objects = manager(Token)
  id = text({primaryKey: true, default: createId})       // cuid-style string
  // or: id = text({primaryKey: true, default: uuidv4})
}
```

:::note
A `default` that is a **function** marks a client-side generator: it runs at
insert time and is never serialized to the migration/DDL. `createId` and
`uuidv4` are dependency-free built-ins; plug in your own (e.g. `@paralleldrive/cuid2`)
by passing any `() => string`.
:::

## Snowflake ids

A snowflake is a 64-bit, time-ordered id in the shape used by Twitter, Discord,
and Shopify. It packs the moment it was minted into its high bits, so ids are
compact and roughly sortable by creation time, yet each process mints them
independently — no round-trip to a central allocator.

```ts
class Order extends Model {
  static objects = manager(Order)
  id = id({snowflake: true})
  total = int()
}
```

`id({snowflake: true})` is a `text` primary key (the 64-bit value round-trips as
a string, so there's no JavaScript number-precision loss), filled by the process
generator and format-validated on write — so every id in the table really is a
snowflake. Seeds and imports mint new snowflake ids rather than carrying fixed or
legacy values. The value looks like `"1780219977399508992"`.

Decode one back into its parts — handy for recovering an entity's creation time
straight from its id:

```ts
import {decodeSnowflake} from '@getcronit/pylon-db'

const {date, nodeId, sequence} = decodeSnowflake(order.id)
```

### Node id: `useDatabase({ nodeId })`

A snowflake's uniqueness comes from `timestamp + nodeId + sequence`. The
**node id** (0–1023) is the per-process identity that keeps ids from two
instances writing to the same database from colliding. Configure it on the
plugin — **not** via an environment variable:

```ts title="pylon.config.ts"
import {useDatabase} from '@getcronit/pylon-db'

export default {
  plugins: [useDatabase({nodeId: 3})]
}
```

`nodeId` accepts:

- **a number** (0–1023) — assign one per instance yourself. Omitted → `0`, which
  is fine for a single writer.
- **`'lease'`** — claim a unique slot from the database at boot and hold it with a
  heartbeat. Multi-instance deploys (PM2 cluster, several hosts) become
  collision-free with zero config.

```ts title="pylon.config.ts"
export default {
  plugins: [useDatabase({nodeId: 'lease'})]
}
```

:::tip
Prefer `'lease'` for anything that runs more than one instance. The database is
the natural coordinator — all writers share one id space, so it hands each a
distinct node id (lowest free slot), and a crashed instance's slot is reclaimed
after a TTL. This avoids the "every instance defaults to node 0 and collides"
trap without any per-instance configuration.
:::

## Global ids (gid)

Global ids are opt-in, Shopify-style opaque handles for your entities:

```
gid://pylon/Order/1780219977399508992
      ^^^^^ ^^^^^ ^^^^^^^^^^^^^^^^^^^^^
      ns    type  raw primary key
```

Enable them with the top-level **`node`** option (it's an API-shape decision, not
a database one — so it lives beside `db`, not inside it):

```ts
export default new Pylon({
  db: {models: [Order]},
  node: true
})
```

With that on, three things happen automatically:

- every model's `id` is returned as a `gid://…` on the wire,
- every model implements a shared `Node` interface, and
- a root **`node(id): Node`** field is added that refetches **any** entity by its
  global id.

:::note
`node` changes the wire shape of `id` (raw → gid). Resolution is **per model**: a
model uses its own `static config.node`, else its app's `node`, else the project
default. Set it once on your **composition root** (it constructs last, so it wins
as the default) to turn it on everywhere; a leaf app can override with
`node: false` to keep its models on raw ids.

```ts
// root: on for the whole project
export default new Pylon({ node: true }).compose(catalog, legacy)

// a leaf that keeps raw integer ids:
export const legacy = new Pylon({ db: {models: [LegacyRow]}, node: false })
```
:::

### Refetching with `node`

`node` is the universal entry point — decode a gid back to its object without
knowing its type up front:

```graphql
query {
  node(id: "gid://pylon/Order/1780219977399508992") {
    __typename
    ... on Order { id total }
  }
}
```

It returns `null` for a well-formed but missing id (Relay semantics), and a
`BAD_REQUEST` error for a malformed one. The lookup runs through the normal
manager, so tenant scoping and [policies](/docs/data/policies) still apply.

### gids on input

Because the API hands out gids, you can pass them straight back into any
primary-key or foreign-key filter — the ORM decodes them to the raw local id,
type-checked. Raw ids keep working too, so nothing breaks:

```ts
// All three resolve the same row:
await Order.objects.get({id: order.id})                          // raw id
await Order.objects.get({id: 'gid://pylon/Order/1780219977399508992'}) // a gid
await Order.objects.filter({id: {in: [someGid]}}).all()
```

The decode is type-checked against the target model: passing a `User` gid where
an `Order` id is expected raises a `BAD_REQUEST` error rather than silently
matching the wrong row. Everything past the query boundary sees the raw id —
your resolver code never has to think about gids.

### Namespace: `useDatabase({ gidNamespace })`

The `pylon` segment is configurable — set it to your app or vendor name
(Shopify-style) so gids are self-identifying. It applies to both encoding and
decoding:

```ts title="pylon.config.ts"
export default {
  plugins: [useDatabase({gidNamespace: 'acme'})]
}
// → gid://acme/Order/1780219977399508992
```

:::tip
Snowflakes and global ids pair naturally: a snowflake is globally unique, so the
gid needs only `type + id` (no tenant leak), and the id is time-ordered and
client-mintable. Use `id({snowflake: true})` + `node: true` + `useDatabase({nodeId: 'lease'})`
for a distributed, collision-free, self-describing id scheme.
:::

Next: connect models with [relations](/docs/data/relations), or configure the
plugin in the [config reference](/docs/reference/config).
