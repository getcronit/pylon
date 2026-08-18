---
'@getcronit/pylon': patch
---

Declare `rolldown` as a runtime dependency (was a devDependency).

`pylon build`/`pylon dev` import `rolldown` directly at runtime (the pages build, the
client build, transpile-app, the db CLI). As a devDependency it wasn't installed for
consumers, so `import 'rolldown'` fell back to the `rolldown@1.0.0-beta.53` that
`rolldown-vite` pulls in — an old beta whose resolver doesn't apply `tsconfig` `paths`.
The result: every `@/…` alias in a consumer's pages silently failed to resolve during
`pylon build` (treated as external → broken client bundle), while the monorepo was
unaffected because a workspace install *does* install devDependencies.

Making `rolldown` a dependency installs the pinned `1.2.4` in pylon's own resolution
scope while `rolldown-vite` keeps `beta.53` in its scope — the two coexist, so the build
gets tsconfig-path resolution and the dev server keeps `rolldown/experimental`'s
`viteWasmFallbackPlugin`. No consumer-side `rolldown` override needed (and such an
override is harmful — it forces `rolldown-vite` onto 1.2.4 and breaks `pylon dev`).
