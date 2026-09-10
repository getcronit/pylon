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

## The FK-retype, expressed in the persisted graph — SHIPPED

`db diff` coordinates a satisfiable cross-app retype (`generateCoordinatedRetype`):
`planCrossAppRetypes` finds the cluster, and the emitter writes the three-phase plan
across apps, wired by tuples, then the normal per-app pass captures anything unrelated.
Validated end to end (e2e `xapp-retype`): uuid→text on a PK referenced same-app AND
cross-app coordinates + migrates with no 42P07. Unsatisfiable (one-sided) retypes stay a
hard refusal. Design below, as built.

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

**Generation order is BACKWARDS from `orderGroups`.** The normal order is
referenced-app-first (products depends on core, so core generates first). The retype plan
is the opposite — the referencing app's `pre` (drop FK) must exist *before* the referenced
app's `retype`, which must exist before the `post`. So the coordinator generates the cluster
in retype order — `products/pre` → `core/retype` → `products/post` — threading each written
migration's name into the next one's `dependencies` tuple. This is why the coordination is a
dedicated pass, not something the per-app `generateGroup` loop can produce.

**Guard:** a cross-app FK's two columns must end up the same type. If only one side retypes
(or they retype to different types), the schema is unsatisfiable — keep the shipped refusal
for that case. The coordinator decides coordinate-vs-refuse per cross-app FK.

**Phase 2 is orthogonal to DATA porting / the cast.** The coordinator only fixes the FK
*structure* (drop → alter → re-add, ordered). It does NOT bypass the `castsImplicitly` gate:
each `alterColumn` still refuses a non-implicit cast without `--using`, exactly as same-app.
So an implicit retype (`uuid → text`) coordinates *and* migrates over existing data (values
convert, FKs stay matched); a non-implicit one (`uuid → bigint`) still stops at diff-time for
a `--using` that often can't exist (no `uuid → bigint` value), leaving the author to hand-add
a data-porting `runSql` (regenerate ids, remap FK columns) — which the tool must never invent.
Phase 2 makes the structure automatic; the data port stays a deliberate manual step when the
cast isn't trivial.

## History-rewrite commands (the accepted cost)

With derivation gone, persisted tuples must survive the commands that rewrite history —
and there is **no derivation fallback if one is missed**, so this is load-bearing. The
loud dangling-tuple error is the safety net: a rewrite that orphans a cross-app edge
fails visibly at the next migrate, naming the broken `app:migration`, rather than
silently reordering.

- **`rename-app`** — DONE. `renameGroupApp` already re-pointed the ledger prefixes
  (`renameAppLedger`); it now ALSO rewrites `[fromApp, *] → [toApp, *]` tuples across every
  app's migration files (balanced-bracket splice of the `dependencies:` array, byte-stable
  elsewhere). Bare same-app deps are relative and untouched. It has `groups`, so it sees
  every app's files.
- **`squash`** — DONE (via the apps-only refactor). It was previously unreachable per-app:
  in apps mode `squash` ran on the *root* runner (an empty root dir). The apps-only CLI makes
  every command group-aware, so `squashGroups(groups, app, …)` squashes one app's history and
  **cascade-rewrites** every sibling's cross-app tuple that named a now-collapsed migration to
  the squashed one (Pylon deletes files rather than keeping Django `replaces` tombstones, so
  cascade-rewrite is the fit). The loud dangling error remains the backstop if one is missed.
- **`baseline`** — group-aware now (operates on the target app), but needs no cascade: it's a
  once-only bootstrap of an un-migrated app, so nothing points *before* it yet.

Individual migrations are never renamed (timestamp names; no rename-migration command), so
the only name churn is app-level — the prefix rewrite `rename-app` now does.

**The cost, named:** these rewrites are a permanent bug surface derivation didn't have — a
rewrite that forgets a dependent leaves a dangling tuple. It's manageable (the commands
already rewrite history; the app/migration count is small; Django lives on exactly this),
made safe by the loud dangling error, and it's the real, ongoing price of the persisted
model.

## Follow-up: `pylon db` apps-only

`pylon db` currently supports both a single root history (non-apps) and per-app groups. The
root path is what forces the `'default'` app label on tuples and leaves `squash`/`baseline`
on a root runner that apps mode can't reach. Making `pylon db` **apps-only** — every project
is one or more apps, no root runner — would: drop the `'default'` label (every migration has
a real app), collapse the dual-mode CLI, and make `squash`/`baseline` group-aware (so their
cross-app cascade above becomes implementable). Recommended as the next refactor; it is
orthogonal to the FK-retype coordination (phase 2) and can land independently.

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
