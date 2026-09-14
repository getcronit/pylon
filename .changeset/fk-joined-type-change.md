---
'@getcronit/pylon': patch
---

Fix: type-changing a column joined by a foreign key no longer aborts the migration with
Postgres `42P07 "constraint … cannot be implemented"`.

A same-app FK-joined retype (the referenced PK and/or the referencing column) now drops the
constraint before the type change and re-adds it after — one migration, one transaction,
reversible. A cross-app FK-joined retype (the two ends change in separate apps'
migrations/transactions) can't be coordinated in a single migration, so `db diff` now
**refuses** at generate time with an actionable message naming both sides, instead of failing
mid-deploy.

Also lays the groundwork for a persisted cross-app migration graph: `dependencies` accepts a
`[app, migration]` tuple alongside the bare same-app name (see rfcs/CROSS_APP_FK_RETYPE.md).
