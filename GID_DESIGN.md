# Global Object IDs (`gid`)

Shopify-style opaque, type-qualified entity handles for Pylon:

```
gid://pylon/Order/123456789012345
      ^^^^^ ^^^^^ ^^^^^^^^^^^^^^^^^
      ns    type  raw primary key (snowflake / cuid / uuid)
```

A gid is a **presentation wrapper only** — storage and every foreign key stay
raw. It gives you a single addressable handle per entity and a universal
`node(id)` refetch entry point, without changing how ids are stored or generated.

## The constraint that shapes the design

A GraphQL scalar's `serialize(value)` receives **only the value** — no parent
type. So a scalar *cannot* emit `gid://pylon/Order/…`, because at serialize time
it has no idea the value belongs to an `Order`. That splits the work into three
layers, with the scalar being the thinnest:

| layer | knows the type? | job |
| --- | --- | --- |
| encode (output) | yes — field-level | raw pk → gid (per-model `id` resolver) |
| decode (input) | depends | gid → raw + type (`node()` / where-builder) |
| `ID` scalar | no | validate + normalize; stays tolerant |

Pylon's advantage: because the compiler *generates* both the `id` field resolver
and the query/where resolvers from your models, the type name is known at codegen
time on **both** boundaries — sidestepping the `globalIdField('Order')`
boilerplate every Relay stack pays.

## Type name ↔ model

A model's (underscore-normalized) **class name IS its GraphQL type name**, and is
unique project-wide (`registry.ts` relies on this for cross-bundle resolution).
`modelForTypeName(type)` is the reverse map used for `node()` dispatch. Because
snowflakes are globally unique, the gid needs only `type + localId` — **no tenant
in the handle**; tenant scoping stays in the ambient resolve context.

## Layers, concretely

**Encode (output).** For each model type `T`, the compiler emits
`resolvers[T].id = root => toGid('T', root.id)`. `root.id` stays raw in the DB and
in every FK. Requires two compiler touches: (1) map primary keys to SDL `ID`, and
(2) emit `interface Node { id: ID! }` with every model `implements Node`.

**Decode (input).**
- `node(id: ID!): Node` needs the type → decodes the full gid itself
  (`resolveNode`), dispatches to the owning model, looks up by PK through the
  normal manager (auth/tenant still apply), tags `__typename`, returns `null` on
  miss (Relay semantics).
- Ordinary `id: ID!` args → the ORM where-builder knows the target model, so it
  calls `decodeId(value, ExpectedType)`: validates the embedded type (passing a
  `User` gid where `Order` is expected throws) and uses the local id. Bare ids
  pass through untouched → back-compatible while clients migrate.

**`ID` scalar (thin).** `serialize` = identity (field resolvers already produced
gids). `parseValue`/`parseLiteral` = validate format + stay tolerant (accept a
gid *or* a bare id); it does **not** strip or dispatch, because it can't know the
expected type.

## Status

### Landed (runtime foundation, `pylon-db`) — tested, no MCP

- `gid.ts` — `toGid` / `fromGid` / `isGid` / `decodeId` / `resolveNode` /
  `GID_NAMESPACE`. Local id is opaque (may contain `/`).
- `errors.ts` — `BadRequestError` (400) for malformed / wrong-type gids.
- `registry.ts` — `modelForTypeName(type)` reverse dispatch.
- Exports wired; `test/gid.test.ts` (codec, 9) + `test/integration/gid-node.test.ts`
  (`resolveNode` dispatch + Relay-null + error paths).

### Landed (slice 1 — compiler / schema wiring) — tested

Two config surfaces, split by build-vs-runtime:

- **Opt-in** (build/SDL decision) is a **per-app `db` flag**: `new Pylon({ db: {
  models, globalIds: true } })`. It sets a project-wide registry flag
  (`enableGlobalIds`) that `toIR()` auto-detects, so the build's `contributeIR`
  picks it up — the introspect child constructs the app, so it sees the flag.
- **Tunables** (runtime) live on **`useDatabase`**, not env / not hardcoded:
  `useDatabase({ nodeId, gidNamespace })`. Applied at `setup()`:
  - `nodeId` → the snowflake node id for `id({snowflake:true})` PKs; read lazily
    so it's set before the first insert. Either a **number** (0..1023), or
    **`'lease'`** — claim a unique slot from the database at boot (multi-instance /
    PM2 cluster safe; see below). Omitted → `0`.
  - `gidNamespace` → `gid://<ns>/…`; seeds a process global the serialized `id`
    encoder reads, so encode (build-emitted) and decode (`fromGid`) share ONE
    namespace with no baked-in literal (this also removes the earlier drift bug).

**Node-id lease (`nodeId: 'lease'`).** Uniqueness is required per-database (all
writers share one id space), so the DB is the coordinator. At `setup()` each
instance takes a transaction-scoped advisory lock, ensures a `_pylon_nodes`
ledger, and upserts the **lowest node id (0..1023) whose row is missing or
stale**, then heartbeats (unref'd timer) to hold it. A crashed instance's slot
goes stale after the TTL (default 60s) and is reclaimed; graceful shutdown
(SIGINT/SIGTERM) frees it immediately. Zero config, no `PYLON_NODE_ID` env, no
birthday-collision risk — the fix for the "every PM2 instance defaults to node 0"
trap. (`leaseNodeId(db, {max, ttlSeconds})` is exported for direct use.)

Snowflake PKs are authored as **`id({ snowflake: true })`** — a `text` PK (so the
64-bit value round-trips as a string, no precision loss) with the generator wired
and a format validator, reading the process node id. `id()` stays a bigint
identity. The low-level `snowflake()` generator remains for `default:` on
arbitrary columns.

1. **`Node` interface + `node(id)` field + `id: ID!`** — `applyNodeInterface` in
   pylon-db `ir.ts` (gated by `toIR(defs, {node})`, default off / auto from the
   flag). Emits `interface Node { id: ID! }`, makes every single-PK entity and
   STI-base interface `implements Node`, and adds root `node(id: ID!): Node`.
2. **Runtime resolvers** — `attachNodeResolvers` in pylon-dev `builder.ts`:
   `Query.node` → `resolveNode` (via dynamic `import('@getcronit/pylon-db')`,
   since `resolvers.js` inlines function source with no imports in scope), and
   each `Node` type's `id` → an inlined `gid://pylon/<Type>/<id>` encoder.
   Merged one level deep over the app's resolvers by `mergeResolverMaps` in
   pylon `pylon-handler.ts` (preserves user `Query`/entity resolvers).
   `Node.__resolveType` is the universal `__typename`-first resolver already
   attached to every SDL interface.

`useDatabase`'s error mapper also maps a thrown `BadRequestError` →
`extensions.code = 'BAD_REQUEST'` (so a malformed/wrong-type gid surfaces
cleanly instead of being masked).

Tests:
- pylon-db `node-interface` (SDL + config wiring) + `gid` codec + `gid-node`
  (`resolveNode` dispatch vs live DB).
- pylon-dev `orm-global-ids` (full build: SDL + emitted resolvers through
  `introspectViaRunner`).
- pylon `node-resolvers` (the one-level-deep merge).
- **e2e `globalids-serve`** (Dockerized, full stack: `pylon build` → `db push` →
  serve `server.mjs` → HTTP): a created entity + list queries return
  `gid://pylon/Note/<snowflake>` ids, `node(gid)` refetches it, an absent gid →
  `null`, a malformed gid → `BAD_REQUEST`.

### Landed (slice 2 — gid on input) — tested

Decoding lives in the **ORM where-builder**, not a global `ID` scalar (a scalar
can't see the expected type, so it couldn't type-check *and* would break `node`'s
dispatch — see the "why ORM, not scalar" reasoning). `compileWhere` decodes gids
for any **PK or FK** filter to the raw local id, type-checked via `decodeId`:

- `Model.objects.get({id: gid})` / `.filter({id: {in: [gid]}})` accept a gid OR a
  raw id interchangeably; the type name comes from the model's own type (PK) or
  the FK's target type.
- A wrong-type gid (`User` gid where a `Note` is expected) throws
  `BadRequestError` → `BAD_REQUEST`.
- Nested relation filters (`where: {author: {id: gid}}`) are covered for free —
  `compileWhere` recurses into the target scope, which decodes against the target
  type.
- The gid is stripped the moment it touches the DB, so every query + row sees the
  raw id — the "code only sees the number" property, kept without a scalar.

`resolveNode` moved to `node-resolve.ts` so `gid.ts` is a pure codec the
where-builder can import without a manager cycle.

Tests: pylon-db `gid-input` integration (get/filter/`in`/FK/wrong-type, 6) + the
`globalids-serve` e2e (a hand-written `note(id)` resolver fetched by gid over
HTTP, round-tripping back to the same gid).

## Edge cases

- **Composite PKs** — no single scalar id; give only single-PK models a gid to
  start.
- **Client cache** — key becomes `__typename:gid`; gid already embeds the type,
  so it stays globally unique (harmless redundancy).
- **FK scalar fields** — don't gid-encode raw FK columns; expose relations as
  nested objects so each `User.id` is encoded by `User`'s own resolver.
- **Output opacity** — readable URI by default (debuggability + no tenant leak);
  base64 is an opt-in output mode for public APIs.
