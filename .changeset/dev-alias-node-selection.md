---
'@getcronit/pylon': patch
---

Fix `usePaginatedData`/`useData` node selections collapsing to `{ id }` in dev.

The dev pages analyzer runs a ts-morph project that maps every non-relative import to an
empty dummy (so third-party packages don't need to be parsed). That dummy also swallowed the
app's own `@/*` path aliases, so a page importing its components and the connection node type
via `@/…` (e.g. `DataGridColumn<AuditEvent>` from `@/components` + `@/.pylon/client`) left the
project too thin for the connection pass to trace inline node-field reads — the selection
collapsed to `node { id }`. On soft navigation the client then fetched partial nodes,
normalized them, and components reading the missing fields (`e.actorLabel`, `e.metadata`)
threw. The production rolldown build was unaffected because it feeds the whole module graph
through the analyzer (every file already loaded by absolute path).

Dev now hands the analyzer the app's `tsconfig.json` so `@/*` resolves to real files, and the
per-module eager-loader follows imports transitively (through aliases, stopping at
`node_modules`) — so the dev selection matches the build byte-for-byte.
