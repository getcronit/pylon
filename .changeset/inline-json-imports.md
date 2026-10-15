---
'@getcronit/pylon': patch
---

Inline JSON imports in the build instead of externalizing them.

Both the pages SSR build and the backend transpile externalized everything under
`node_modules`, including `.json`. A bundler-visible `import x from "pkg/x.json"` (e.g. the app
importing `i18n-iso-countries/langs/de.json`) therefore survived to runtime, where Node's
strict ESM loader rejects it for lacking a `with { type: 'json' }` attribute
(`ERR_IMPORT_ATTRIBUTE_MISSING`) — crashing a plain `node .pylon/server.mjs` / standalone
artifact at plugin setup.

`.json` is now inlined by rolldown (its default, and what the client bundle already did),
keeping the output runtime-agnostic (no attribute, no loose file) rather than relying on a
per-runtime Node loader hook. A dependency that dynamically `require`s its OWN data files at
runtime is unaffected: its JS stays external, so those requires still resolve from disk.
