---
'@getcronit/pylon': major
---

Consolidate the monorepo into a single batteries-included `@getcronit/pylon` package.

The previously separate `@getcronit/pylon-{db,ir,query,queues,auth,pages,dev}`
packages are now folded into `@getcronit/pylon` and exposed as subpath exports.
The `pylon` CLI now ships from `@getcronit/pylon` itself (no separate
`@getcronit/pylon-dev`).

### Migration

- Replace feature imports with the matching subpath:
  - `@getcronit/pylon-db` → `@getcronit/pylon/db`
  - `@getcronit/pylon-ir` → `@getcronit/pylon/ir`
  - `@getcronit/pylon-query` → `@getcronit/pylon/query`
  - `@getcronit/pylon-queues` → `@getcronit/pylon/queues`
  - `@getcronit/pylon-auth` → `@getcronit/pylon/auth` (`/contract`, `/zitadel` preserved)
  - `@getcronit/pylon-pages` → `@getcronit/pylon/pages`
- Plugin factories now live under a per-feature `/plugin` subpath:
  - `useDatabase` → `@getcronit/pylon/db/plugin`
  - `useQueues` → `@getcronit/pylon/queues/plugin`
  - `useIdentity` → `@getcronit/pylon/auth/plugin`
  - `usePages` → `@getcronit/pylon/pages/plugin`
- Drop every `@getcronit/pylon-*` dependency from your `package.json` and depend on
  `@getcronit/pylon` alone. The `pylon` binary comes from it.
