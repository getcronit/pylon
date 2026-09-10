---
'@getcronit/pylon': patch
---

Keep node_modules external in the usePages SSR/node build.

The SSR bundle previously externalized only a 5-package allowlist and **bundled every
other dependency** — backwards for server-side rendering, where node_modules are on disk
at runtime. Bundling them duplicates singletons and breaks any dependency that
dynamically `require`s its own data files (e.g. `i18n-iso-countries`'s `langs/*.json`,
which aren't emitted beside the chunk → `Cannot find module './langs/br.json'`). The SSR
build now externalizes anything that resolves into `node_modules` (keeping the bare
specifier so Node resolves it at runtime), while still bundling app code — relative
imports and tsconfig path aliases (`@/…`) — and still handling CSS/asset imports
(a `.css` from a package like `nprogress` stays bundled for the css plugin, not
externalized). Workspace-linked framework packages resolve outside node_modules, so the
explicit allowlist remains for those.
