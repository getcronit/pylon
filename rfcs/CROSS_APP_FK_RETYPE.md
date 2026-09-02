# RFC: A persisted cross-app migration graph (+ cross-app FK retypes)

Status: **design.** Part 1 (same-app FK-safe retype + cross-app refusal) is **shipped**.
This RFC covers two coupled follow-ups:

- **B.** Replace Pylon's *derived* cross-app ordering with a **persisted, Django-style
  `(app, migration)` dependency graph** — one edge source, inspectable, able to express
  cross-app orderings that aren't schema facts.
- **FK retype.** Use that graph to coordinate a cross-app FK-joined type change (today
  refused), as the first thing built on it.

## The immediate problem (FK retype)

Changing the SQL type of a column in a foreign key requires the constraint to be
**absent** while the type changes — Postgres re-validates a dependent FK the moment either
side changes type, and aborts with `42P07 "constraint … cannot be implemented"` if the
two sides momentarily disagree.

**Same-app** is solved (`diffSchema` drops the FK, alters both columns, re-adds it — one
migration/transaction, reverses cleanly). **Cross-app** can't be one transaction:

```
core_location.id                       ← referenced PK, retyped in the CORE migration
products_inventory_level.location_id   ← referencing col, retyped in the PRODUCTS migration
```

No order of the two alters works while the FK exists. The constraint must be gone across
**both** alters — an irreducible three-phase sequence:

```
1. products:  DROP FK  +  ALTER products_inventory_level.location_id TYPE text   (app-local)
2. core:      ALTER core_location.id TYPE text                                    (app-local)
3. products:  ADD FK                                                              (app-local)
```

Core's step (2) must interleave *between* products' (1) and (3). Since a migration is one
atomic unit, (1) and (3) can't be the same migration, and (1) must run **before** core —
the opposite of the group dependency order. This needs migration-granularity, cross-app
ordering that is first-class and authorable.

**Shipped today:** `generate()` detects this (`crossAppRetypeRefusals`) and **refuses**.
This RFC replaces the refusal with coordination, on top of B.

## Decision B: persisted `(app, migration)` tuples; derivation retired

Today cross-app ordering is **derived** every apply from each migration's `changes`
(`applyGroupsInterleaved` → `tablesOf`: a migration referencing a table waits for the one
creating it). Derivation is self-healing and needs no bookkeeping, but it can only express
**schema facts** — never a cross-app *data*-migration ordering — and it isn't inspectable.

We move to **persisted tuples**: `dependencies` becomes `Array<[app, migration]>`,
**always a tuple** (no bare-string form, no `string | [app,name]` union). The autodetector
emits edges at **generate** time; apply just replays them. Derivation is **retired** — one
edge source, not two. (A hybrid that kept derivation *and* tuples was considered and
rejected: it means unioning two edge sources at apply time AND still needing the
tuple-rewrite machinery below — strictly more complex than either pure model.)

What this buys: inspectable cross-app edges, and hand-authorable cross-app ordering that
isn't a schema fact (the capability the derived model structurally lacks). What it costs
is stated under "The accepted cost" below — named so it isn't a surprise.

### Why this is safe on deployed databases

- **Checksums exclude `dependencies`.** `migrationChecksum` hashes only
  `operations[].fingerprint`, so editing the deps of an already-applied file — during the
  one-time conversion below — never trips the tamper guard.
- **Ledger identity is unchanged.** The applied-set is keyed by app-prefixed `name`
  (`core:20260101_x`); a tuple `[core, 20260101_x]` maps onto that exact key. Nothing looks
  unapplied; nothing re-runs.

### Converting the existing history — by hand

Because derivation is retired, existing migration files must carry ALL their edges as
tuples. This is a **one-time, manual** edit (the project has only a few deployed
migrations), not an autofix/backfill command:

- convert each intra-app parent `"x"` → `["thisApp", "x"]`, and
- add the cross-app edges that used to be derived (the table-existence edges: a migration
  that FKs into another app's table gains `["thatApp", "<its create migration>"]`).

To make the hand-edit correct rather than guessed, a throwaway `db graph --derived` dump
can print the edges derivation currently computes for the whole history; the human copies
them into the files. The dump is a convenience, not a persisted command. Safe because deps
aren't checksummed; auditable because it lands as a normal diff in one PR.

This conversion is a **cutover**: the tuple-only loader and the converted files land
together (there's no bare-string fallback to bridge them). Small, because the history is
small.

## The FK-retype, expressed in the persisted graph

The generator, on detecting a cross-app FK retype (reuse the shipped
`crossAppRetypeRefusals` walk as the trigger), emits the three-phase plan as app-local
migrations wired by tuples:

- `products/…_retype_pre`: `dropForeignKey(fk)` + `alterColumn(location_id)`.
- `core/…_retype`: `alterColumn(id)`, `dependencies: [['products', '…_retype_pre']]`.
- `products/…_retype_post`: `addForeignKey(fk)`,
  `dependencies: [['core', '…_retype'], ['products', '…_retype_pre']]`.

One `db diff` now emits **two** migrations for the referencing app (pre/post) — the one
real ergonomic change; `db diff`'s summary must explain the split. `down` reverses the
whole plan by the same (reversed) tuples: drop the re-added FK → revert both types → re-add
the original FK — the shape the same-app path already round-trips.

**Guard:** a cross-app FK's two columns must end up the same type, and Pylon does not
auto-derive the FK column type from the referenced PK. If only one side retypes, the schema
is unsatisfiable — keep the shipped refusal for that case.

## History-rewrite commands (the accepted cost)

With derivation gone, persisted tuples must survive the commands that rewrite history —
and there is **no derivation fallback if one is missed**, so this is load-bearing. These
commands already do coordinated history surgery, so the additions fit:

- **`squash`** already deletes the collapsed files and reconciles the ledger
  ([migration-runner.ts:846-906](packages/pylon/src/db/migration-runner.ts)), refusing on
  partial application. Add: **cascade-rewrite** every cross-app tuple pointing into the
  squashed range to the squashed migration. (Pylon deletes files rather than keeping
  Django-style `replaces` tombstones, so cascade-rewrite is the natural fit.)
- **`rename-app`** already rewrites ledger prefixes (`renameAppLedger`). Add: a bulk
  `[oldApp, *] → [newApp, *]` rewrite of tuples across all apps' files.
- **`baseline`**: a baseline that adopts a DB must terminate cross-app tuples pointing
  before it. **`merge`** already writes a node depending on all heads — extend to cross-app
  heads where relevant.

Individual migrations are never renamed (timestamp names; no rename-migration command), so
the only name churn is app-level — a prefix rewrite.

**The cost, named:** these rewrites are a permanent bug surface derivation didn't have — a
`squash` that forgets a dependent leaves a dangling tuple and a broken apply. It's
manageable (the commands already rewrite history; the app/migration count is small; Django
lives on exactly this), but it's the real, ongoing price of the persisted model, and it
must be covered by the command tests below.

## Open questions

1. **Non-schema cross-app ordering.** B's payoff is a hand-authored `dependencies:
   [['otherApp', '…']]` on a migration for orderings that aren't schema facts (cross-app
   data migrations). Confirm the authoring surface and validate tuples at load (unknown
   app/migration → clear error, not a silent drop).
2. **Dangling-tuple detection.** With no derivation fallback, a dangling tuple must fail
   **loudly at load/apply** with the offending `[app, migration]`, not be silently skipped
   (the current `depsOf` filters unknown deps — that filter must become an error for
   tuples).
3. **Onward-referenced chains.** A referencing column that is itself a PK referenced by a
   third app fans the drop/re-add out transitively. v1 may refuse on depth > 1 and handle
   the single hop; the tuple model generalizes, the pre/post emission gets hairier.
4. **`db check` / status.** The pre/post split must fold to the same baseline a single
   migration would, so status/check see no phantom pending change (round-trip invariant).

## Test plan

- **Graph move:** loader/`heads`/`applyGroupsInterleaved` on tuple-only deps; a dangling
  `[app, migration]` fails loudly; the converted sample history applies identically to its
  pre-conversion (derived) order.
- **FK retype:** two-group round-trip (referenced PK in group A, referencing column in
  group B) — assert the interleave runs pre → both-alters → post via the emitted tuples and
  reverses; unit-test the autodetector's tuple emission + pre/post split + the
  "one side only ⇒ refuse" guard.
- **Commands:** `squash` cascade-rewrites dependents (and a forgotten dependent is caught
  by a dangling-tuple test); `rename-app` rewrites tuple prefixes; both leave the ledger
  consistent.
- Keep the seeded fuzz walking; add cross-app FK retypes to its mutation set.

## Sequencing

1. **Graph move (behavior-preserving):** tuple-only `dependencies`; autodetector emits the
   existing table-existence edges as tuples at generate time; retire derivation;
   dangling-tuple = loud error; cascade-rewrite into `squash`/`rename-app`/`baseline`;
   hand-convert the existing history. Same edges as today, now persisted — no ordering
   behavior change, which makes it verifiable against the pre-conversion order.
2. **FK-retype coordination:** the pre/post emission + FK-lifecycle tuples, replacing the
   shipped refusal (except the genuinely-unsatisfiable one-side-only case).

Both build on the shipped Part 1: `crossAppRetypeRefusals` is the coordinator's trigger,
and the same-app drop→alter→re-add is the shape each app-local phase emits.
