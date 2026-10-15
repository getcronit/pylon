---
'@getcronit/pylon': minor
---

Cross-app migration ordering is now a **persisted dependency graph**, not derived at apply time.

Previously the interleaved apply re-derived cross-app order every run from each migration's
schema `changes` (which migration creates a table another references). Now `db diff` records
that edge once, at generate time, as a `[app, migration]` tuple in the migration's
`dependencies` — so cross-app order is **inspectable in the file**, and you can hand-author a
cross-app dependency that isn't a schema fact (e.g. ordering a data migration in one app after
one in another) — something derivation structurally could not express.

- `dependencies` accepts `[app, migration]` tuples beside the bare same-app name (bare = this
  app), normalized at load. Existing bare-name histories are unaffected.
- A cross-app dependency naming a migration that doesn't exist now **fails loudly** at
  apply/generate, instead of being silently ignored.
- Apply-time derivation of cross-app edges is retired; the interleave runs on the intra-app
  sequence plus the persisted tuples.
