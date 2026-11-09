---
'create-pylon': patch
---

Build `create-pylon` with rolldown instead of esbuild. esbuild was removed when the repo
standardized its build pipeline on rolldown, which left `create-pylon`'s build script
calling a binary that no longer exists (`esbuild: not found`). It now bundles the CLI via
a `rolldown.config.mjs` — same output shape (single ESM file, deps external, shebang
preserved).
