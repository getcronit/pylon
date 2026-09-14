---
'@getcronit/pylon': patch
---

`pylon db rename-app` now rewrites cross-app dependency tuples, not just the ledger.

With the persisted cross-app migration graph, a `[oldApp, migration]` tuple in another app's
migration file would dangle after an app rename. `rename-app` now also rewrites every
`[fromApp, *]` tuple across all apps' migration files to `[toApp, *]` (bare same-app deps are
relative and untouched), so the graph stays consistent. If a rewrite is ever missed, the
dangling edge fails loudly at the next migrate rather than silently reordering.
