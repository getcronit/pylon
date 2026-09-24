---
'@getcronit/pylon': patch
---

`useQueues` no longer binds the per-job ORM runner or the transactional outbox unless a
database is actually connected. Previously it wired `getDatabase().run(...)` around every job
whenever `@getcronit/pylon/db` was importable — which it always is in the monorepo (and in any
app that has pylon-db installed) — so a queues-only app (`plugins: [useQueues()]` with no
`useDatabase()`) failed 100% of its jobs at runtime with "No active database", even though the
processors never touched the ORM.

`useQueues` now gates the ORM runner and the outbox on whether a DB is connected at setup time
(a new `hasDatabase()` predicate; `useDatabase()` is a `'first'`-strategy plugin, so its
`connect()` has already run by the time `useQueues`, a `'last'` plugin, sets up). Without a
database it keeps the default passthrough job runner and skips the outbox, so jobs run fine.
Setting `outbox: true` explicitly with no database now logs a warning (the default implicit
outbox stays silent).
