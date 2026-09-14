# Finding: `rolldown` must be a runtime dependency

**Severity:** high (silently breaks every consumer's page build)
**Fix:** move `rolldown` from `devDependencies` → `dependencies` in `packages/pylon/package.json`
**Surfaced by:** migrating the lokalis app onto a published canary (`@getcronit/pylon@canary-pr-112`)

## Symptom

In a **consumer** project (not the monorepo), `pylon build` emitted a flood of
`UNRESOLVED_IMPORT` warnings — every `@/…` tsconfig-path alias in `pages/**` was
"treated as an external dependency" → the client bundle was broken. The same app built
cleanly inside the pylon monorepo (docs). `pylon dev` worked in both (it resolves `@/`
via the explicit `vite-tsconfig-paths` plugin, a different code path).

## Why it was a red herring hunt

The obvious suspect — tsconfig — was **identical**: `@/*: ["./*"]`, no `baseUrl`, and
`tsc --showConfig` produced byte-identical resolved configs for the working (docs) and
broken (lokalis) projects. Copying docs's exact tsconfig into lokalis still failed. The
files all existed on disk. Same declared rolldown version (`1.2.4`), same build code in
the published dist. Everything relevant looked equal.

## Root cause

The pages **build** resolves `@/` via **rolldown's native tsconfig-`paths` support**
(added in a recent rolldown; the build has no explicit alias plugin). The build code
`import`s `rolldown` directly:

- `src/pages/plugins/use-pages/build/index.ts` (+ `rolldown-plugins.ts`)
- `src/cli/builder/build-client.ts`, `src/cli/builder/bundler/transpile-app.ts`
- `src/cli/db/index.ts`

But `rolldown@1.2.4` was declared as a **devDependency**. Consumers install a package's
`dependencies`, **not** its devDependencies — so `1.2.4` was never installed for them.
Meanwhile `rolldown-vite@7.3.1` (a real dependency) pulls in `rolldown@1.0.0-beta.53`,
which got hoisted into the consumer graph. So the pylon build code's `import 'rolldown'`
resolved to **beta.53** — an old beta whose `oxc` resolver does **not** apply tsconfig
`paths` → `@/` unresolved.

The monorepo was immune because a **workspace install installs devDependencies**, so
`1.2.4` was present and won resolution for the pylon package.

Confirmed by pinning the consumer to `1.2.4` (via a temporary override): `910 → 0`
unresolved.

## Why a consumer-side override is the wrong fix

Forcing `rolldown@1.2.4` globally (a pnpm `overrides` entry) fixes the build but **breaks
`pylon dev`**: `rolldown-vite@7.3.1` imports `viteWasmFallbackPlugin` from
`rolldown/experimental`, which exists in `beta.53` but not `1.2.4` →
`SyntaxError: … does not provide an export named 'viteWasmFallbackPlugin'`.

The two rolldowns must **coexist**: the pylon build on `1.2.4`, `rolldown-vite` on
`beta.53`. Declaring `rolldown` as a **direct dependency** of pylon does exactly that —
pnpm installs `1.2.4` in pylon's own scope and leaves `beta.53` in `rolldown-vite`'s
scope. No override.

## The fix

`rolldown` → `dependencies` (pinned `1.2.4`). Verified in the workspace:
`pylon → rolldown 1.2.4`, `rolldown-vite → rolldown 1.0.0-beta.53`.

## Lesson / guard against recurrence

Anything the **runtime** (`pylon build` / `pylon dev` / the CLI) imports must be a
`dependency`, never a `devDependency` — devDeps are invisible to consumers. A packaging
lint worth adding: scan the published `dist/**` (and `src/**`) for bare `import`s and
assert every non-`node:` specifier is declared in `dependencies` (or `peerDependencies`),
so a build-tool import can never again be classified dev-only.
