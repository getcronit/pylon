---
'@getcronit/pylon': patch
---

Fix `@inContext` missing from client documents under `pylon dev`, and drop the dead
`createPagesClient` export.

`pylon dev` builds the SSR bundle with the rolldown analyzer and the CLIENT bundle with the
Vite one. Only the rolldown path was told about `i18n`, so dev shipped a server that knew the
locale and a client that did not: SSR rendered German, then the first refetch sent a
directive-less document and the page flipped to English. Production was unaffected — the
worst place for a difference to live, since dev is where it would be seen and dismissed.

Reproduced in a browser before fixing: the wire carried `query page_0 { serverGreeting }` with
no variables, and the DOM went `Server: hallo` → `Server: hello`.

The dev server now reads the `usePages` plugin's own options — `usePages` in dev is only a
`pages/` directory check, so the plugin is the sole source of whether i18n is configured — and
`Plugin.options` exposes them, since options passed to a plugin factory are otherwise captured
in its closure.

Also removes `createPagesClient` from the generated client. It was introduced with the
pylon-query layer and never called by anything; parameterising it with a locale (as an earlier
pass did) was polish on dead code. Apps needing a per-request SSR client can use
`createPylonQueryClient` from `@getcronit/pylon/query`, which takes a locale.
