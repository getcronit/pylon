---
'@getcronit/pylon': minor
---

`db diff` now COORDINATES a cross-app foreign-key retype instead of refusing it.

When a column's type change is joined across apps by an FK (e.g. `core.Location.id`
uuid→text, referenced by `products.InventoryLevel.location_id`), `db diff` emits a
coordinated three-phase plan across the apps, wired by cross-app dependency tuples so the
interleave applies it in the one safe order:

- `<referencing app>/…_retype_pre` — drop the FK + retype the referencing column
- `<referenced app>/…_retype` — retype the referenced column (and bracket its own same-app
  FKs), depending on every pre
- `<referencing app>/…_retype_post` — re-add the FK, depending on the referenced migration

`db migrate` then applies it without the `42P07 "constraint cannot be implemented"` abort.
A retype where only ONE side changes (or the two ends move to different types) is still a
hard refusal — both ends of an FK must end up the same type. Coordination is orthogonal to
data porting: it fixes the FK structure but still refuses a non-implicit cast without
`--using`, so a `uuid → text` retype migrates over existing data while a `uuid → bigint` one
still needs a manual data-port `runSql`.
