# Pylon consolidation — full migration plan

Collapse the 9-package monorepo into the **Next.js shape**: one fat
`@getcronit/pylon` (runtime **+** the `pylon` CLI/build toolchain) plus a separate
`create-pylon` scaffolder. Dev installs everything unbundled; production ships a
tiny **nft-traced** artifact that strips the build tooling automatically.

Do this in **beta** (no deprecation cost) and as its **own branch**, after the
current feature PR lands. Preserve git history on every move (`git mv`, moves and
edits in separate commits — see §6).

---

## 1. End state

**Published packages: 2** (down from 9) — mirrors `next` + `create-next-app`:

| Package | Role | Next equivalent |
| --- | --- | --- |
| `@getcronit/pylon` | runtime + `pylon` CLI/build (fat) | `next` |
| `create-pylon` | `npm create pylon` scaffolder | `create-next-app` |

Everything else folds into `@getcronit/pylon`: `pylon-db`, `pylon-pages`,
`pylon-query`, `pylon-queues`, `pylon-auth`, `pylon-ir`, **and `pylon-dev`**.

Trusted-publisher configs: **4** (2 packages × release + canary) instead of 18.

---

## 2. Hard prerequisite: nft tracing is the DEFAULT of `pylon build`

Folding `pylon-dev` in is **only safe** because production is deployed as an
nft-traced artifact — the running server never imports `esbuild`/`ts-morph`, so
they're traced out of the deploy even though they're regular deps of the fat
package. This is Next's `output: 'standalone'` — except we make it the **default**,
not an opt-in flag.

Why default (unlike Next): Next gates it for backward-compat with existing
`.next/` + `next start` deploys. We have none — beta, no users, single fat package
where tracing is *mandatory* (skip it → ship esbuild/ts-morph/sharp/everything). An
opt-in flag is a footgun (forget it → fat deploy). So:

- **`pylon build`** → produces a deployable, self-contained (traced, minimal
  `node_modules`) artifact by default.
- **`pylon build --no-trace`** → escape hatch: raw `.pylon/` only (CI typecheck,
  debugging), assumes the full install is present.
- **`pylon dev`** is unaffected — it runs unbundled against the full `node_modules`
  and never traces, so the trace cost (~15s) only hits production builds.

**Ship this first.** The prototype (`docs/scripts/nft-standalone.mjs`) proved it
works and surfaced the 5 fixes it must encode:

1. Resolve export conditions as the runtime does: `['node','import','module-sync','module']`.
2. Whole-copy dynamic-require packages (`@opentelemetry+*`, `@sentry+*`) as a net.
3. `verbatimSymlinks: true` on every copy (pnpm `.pnpm` layout).
4. Trace `.pylon/__pylon/**` + `.pylon/client/**` (usePages request-time modules) as
   extra entry points so their deps (react) are copied.
5. Whole-copy the entire `.pylon` app output; let nft prune only `node_modules`.

Deliverable: `pylon build` emits a traced, deployable `.pylon/` (closure +
`content/`/static + `package.json`) by default; the Dockerfile just `COPY`s it.
Until this exists and is green, **do not** fold `pylon-dev` in.

---

## 3. Target internal layout

Keep the monorepo *source* organized; publish it as one package.

```
packages/pylon/
  package.json            # fat: bin, exports map, merged deps (§4, §5)
  src/
    index.ts              # core (existing): Pylon class, handler, config, plugins
    db/                   # ← packages/pylon-db/src
    pages/                # ← packages/pylon-pages/src        (runtime half)
    query/                # ← packages/pylon-query/src
    queues/               # ← packages/pylon-queues/src
    auth/                 # ← packages/pylon-auth/src
    ir/                   # ← packages/pylon-ir/src           (internal; no export)
    cli/                  # ← packages/pylon-dev/src          (the `pylon` bin + dev/build)
    build/                # build-time: pages analyzer + query compiler (internal, used by cli)
packages/create-pylon/    # unchanged (separate package)
```

Delete after moving: `packages/pylon-{db,pages,query,queues,auth,ir,dev}/`.
Update `pnpm-workspace.yaml` to `packages/*` → effectively `pylon` + `create-pylon`.

---

## 4. `exports` map + bin

```jsonc
{
  "name": "@getcronit/pylon",
  "type": "module",
  "bin": { "pylon": "./dist/cli/index.js" },
  "exports": {
    ".":                     "./dist/index.js",           // core: Pylon, PylonConfig, core plugins (useSentry)
    "./db":                  "./dist/db/index.js",        // ORM authoring API: Model, fields (Node)
    "./db/plugin":           "./dist/db/plugin.js",       // useDatabase
    "./queues":              "./dist/queues/index.js",    // queue/job authoring API (Node)
    "./queues/plugin":       "./dist/queues/plugin.js",   // useQueues
    "./auth":                "./dist/auth/index.js",      // principal + authz API (Node)
    "./auth/plugin":         "./dist/auth/plugin.js",     // useIdentity
    "./auth/contract":       "./dist/auth/contract.js",
    "./auth/zitadel":        "./dist/auth/zitadel.js",
    "./pages":               "./dist/pages/index.js",     // BROWSER runtime: useData, components
    "./pages/plugin":        "./dist/pages/plugin.js",    // usePages (Node/build)
    "./pages/index.css":     "./dist/pages/index.css",
    "./query":               "./dist/query/index.js",     // BROWSER typed-client runtime
    "./tsconfig.pylon.json": "./tsconfig.pylon.json"
  },
  "files": ["dist", "tsconfig.pylon.json"]
}
```

**Uniform convention: `<feature>` = authoring API, `<feature>/plugin` = config
plugin.** Every feature exposes both, so config imports are consistent —
`useDatabase` from `./db/plugin`, `useQueues` from `./queues/plugin`, `useIdentity`
from `./auth/plugin`, `usePages` from `./pages/plugin` — and no feature is a special
case (the old wart was pages having `/plugin` while others didn't). Meanwhile model
files import `Model` from `./db`, `.tsx` imports `useData` from `./pages`, etc.,
without ever pulling the plugin's connection/build machinery.

Why per-feature `/plugin` and **not** one `@getcronit/pylon/plugins` barrel:
`pylon.config` is imported at **production runtime** (`server.mjs`), and an ESM
re-export barrel **evaluates every re-exported plugin's top-level even if unused** —
dragging usePages' build machinery / `bullmq` / `kysely` into the runtime graph that
nft then traces into the deploy. Per-feature subpaths load **only the plugins config
actually imports**, so they give the same consistency without that hazard.

This also **isolates each plugin's heavy/lazy deps** into its own `/plugin` module
(kept side-effect-free, deps behind call-time `import()`), which the nft-strip +
optional-peer design needs anyway. Source: each feature dir gets an `index.ts`
(authoring API) **and** a `plugin.ts` (the `useX` plugin).

- **Core-level plugins** (`useSentry`, `useViewer`) stay on core `.` for now (config
  already imports `Pylon`/`PylonConfig` from there); give core its own `./plugin` too
  only if that set grows.
- **Internal (no public export):** `ir`, the **query build-time compiler** (today's
  `pylon-query/build`, used only by the pages analyzer), `src/build/**`, and
  `src/cli/**` (reached via `bin`, not `exports`).
- **`./pages` and `./query` must stay browser-clean** (no transitive Node-only
  imports) — they bundle into the client. Enforce with a bundle-size/CI check.
- Carried over verbatim from today's packages and easy to miss: pages `./index.css`,
  auth `./contract` + `./zitadel`, core `./tsconfig.pylon.json`.

---

## 5. Dependency classification

**Regular `dependencies`** (always installed; light engines + the build toolchain —
nft strips the toolchain from deploys):
`hono`, `graphql`, `graphql-yoga`, `@graphql-tools/*`, `@envelop/core`,
`graphql-scalars`, `kysely`, `react-router`, `mitt`, `mime`, `consola`,
`escape-string-regexp`, `openid-client`, **`rolldown`, `tsdown`, `ts-morph`,
`chokidar`, `tiny-glob`, `postcss-load-config`** (build-only, but regular deps like
Next's swc; `esbuild` → `rolldown`, see §11. `ts-morph` stays — it's the type-aware
engine, not a bundler).

**Optional `peerDependencies`** (+ `peerDependenciesMeta.optional`; lazy-`import()`
at point of use, friendly error if absent):

| Dep | Why |
| --- | --- |
| `pg` / `mysql2` / `better-sqlite3` | DB driver — user picks (Django-normal) |
| `react`, `react-dom` | singleton; user has them |
| `bullmq`, `ioredis` | Redis infra opt-in |
| `sharp` | ~15 MB native; image opt only |
| `lucide-react` | ~42 MB icons; let users bring their own |
| `@sentry/*`, `toucan-js` | observability opt-in |

---

## 6. Git-history-preserving moves (do this exactly)

Git infers renames from **content similarity at diff time** — it does not store
them. A rename is only detected if the file is ≥~50% unchanged. So:

> **Rule: move in one commit, edit in the next. Never move + rewrite in the same commit.**

### Procedure

1. **Pure move commit** — `git mv` only, zero content edits, and skip hooks so a
   formatter can't mutate files mid-move:
   ```bash
   git mv packages/pylon-db/src     packages/pylon/src/db
   git mv packages/pylon-ir/src     packages/pylon/src/ir
   git mv packages/pylon-query/src  packages/pylon/src/query
   git mv packages/pylon-queues/src packages/pylon/src/queues
   git mv packages/pylon-auth/src   packages/pylon/src/auth
   git mv packages/pylon-pages/src  packages/pylon/src/pages
   git mv packages/pylon-dev/src    packages/pylon/src/cli
   git commit --no-verify -m "refactor: move package sources into pylon/src (moves only, no content changes)"
   ```
   One move-commit per package is even safer for review; either way keep them
   edit-free.

2. **Verify rename detection** before proceeding:
   ```bash
   git log --follow --oneline -- packages/pylon/src/db/manager.ts   # shows pre-move history
   git show --stat HEAD | grep -c '=>'                              # renames, not add/delete
   ```
   If a file shows as delete+add, the move commit wasn't clean (something edited
   it) — redo it.

3. **Edit commits (separate)** — now rewrite imports, add the `exports` map, merge
   deps, delete old `package.json`/`tsconfig`, fix the build. These modify the
   already-renamed files, so history follows.

### Enduring rules

- Always `git mv`; **never** `rm` + create-new (kills rename detection).
- Keep move commits **formatter-free** (`--no-verify`, or disable lint-staged).
- Don't reorganize *within* a file in the move commit.
- History reads back via `git log --follow <file>` and `git blame -C -C -C <file>`
  (plain `git log <file>` stops at the rename — that's inherent to git; document it
  for the team).
- Rebases/merges re-detect renames, so this survives the branch's life.

---

## 7. Import rewrites (edit phase)

Cross-package specifiers become intra-package paths (or subpath exports). Do as
its own commit(s) after the moves:

| From | To |
| --- | --- |
| `@getcronit/pylon-db` | `../db` / `@getcronit/pylon/db` |
| `@getcronit/pylon-query` | `../query` |
| `@getcronit/pylon-query/build` | `../build/query-compiler` (co-located, internal) |
| `@getcronit/pylon-ir` | `../ir` (internal) |
| `@getcronit/pylon-pages/plugin` | `@getcronit/pylon/pages/plugin` |
| `@getcronit/pylon-auth` | `../auth` |
| `@getcronit/pylon-queues` | `../queues` |

Automate + eyeball:
```bash
grep -rl '@getcronit/pylon-' packages/pylon/src | # then codemod per table
  xargs sed -i '' 's#@getcronit/pylon-db#@getcronit/pylon/db#g'   # etc.
```

Also update **build-time package-name references** (they hardcode the old names):
`emit-server-glue.ts`, the bundler/build order, `e2e/package.json` pretest,
`create-pylon` templates, and any `dependsOn`/plugin-name wiring.

---

## 8. Execution order

1. **Land the current feature PR to `main`.** (Merging opens a Version-Packages PR;
   nothing publishes to `@latest` until that merges — safe.)
2. **Make nft tracing the default of `pylon build`** (+ `--no-trace` escape hatch) +
   switch the Dockerfile to the traced output. Verify on the docs app (already
   prototyped). **Gate.**
3. **Consolidation branch:**
   a. §6 pure-move commits (history preserved).
   b. §7 import rewrites + `exports` map + `bin` (edit commits).
   c. §5 dependency reclassification (regular / optional-peer).
   d. Fold `pylon-ir` + build-time code as internal; wire `cli` as the `pylon` bin.
   e. Update `pnpm-workspace.yaml`, delete folded package dirs, regen lockfile.
   f. Delete per-package changesets; add one `major` changeset for `@getcronit/pylon`.
   g. Update `create-pylon` templates to the new import paths + install `@getcronit/pylon`
      as the app's dep (dev tooling now comes with it).
4. **OIDC trusted publishers** on the 2 packages (4 configs). Bootstrap-publish the
   never-published names once with a token, then switch to OIDC.
5. **Publish the first single-package beta.**

---

## 9. Risks & validation

- **nft dynamic corners** (see §2) — re-validate after the fold: sharp native load,
  bullmq workers, pages SSR `import()`, shiki grammars, `require(var)`.
- **Browser-clean subpaths** — `./pages` + `./query` must not drag Node-only code
  into the client bundle. CI bundle-size assertion.
- **Model registry** — one model-class instance still shared app↔config after the
  fold (the reason the server stays unbundled in dev).
- **History spot-check** — `git log --follow` on a file from each folded package.
- **Optional-peer errors** — each feature that hits a missing peer throws a clear
  "run `npm i <dep>`", not a raw `Cannot find module`.

---

## 10. Rollback

Each phase is a separate commit range on a branch; revert the consolidation commits
to return to the 9-package layout. Because moves are clean `git mv` renames,
reverting restores the original paths with history intact.

---

## 11. Build & bundle toolchain — rolldown (replaces esbuild)

Swap **esbuild → rolldown** (Rust, by the Vite team, parses via Oxc, rollup-plugin
compatible). It's what Vite migrated to (rolldown-vite), and it beats esbuild on the
things Pylon actually needs: code-splitting, CSS handling, tree-shaking, and the
rollup plugin ecosystem.

| Job | Tool | Why |
| --- | --- | --- |
| Client / pages browser bundle | **rolldown** | splitting + CSS + assets + tree-shaking |
| Framework library build (`packages/pylon` → `dist`) | **tsdown** (rolldown-based lib bundler, same team) | bundle + `.d.ts` in one |
| workerd worker bundle (edge deploy) | **rolldown** | single-module worker, no node_modules at edge |
| Node server | **not bundled** | unbundled `.pylon/server.mjs` + nft trace (§2) |
| `useData`/`prepare` static analysis | **ts-morph (unchanged)** | needs TYPE info; rolldown/Oxc are syntax-only |

- `esbuild` → `rolldown` (+ `tsdown`) in the deps (§5). Both ship Rust native
  binaries (~10 MB), are build-only, and are nft-stripped from deploys.
- Oxc (rolldown's core) can later replace *type-free* transpile spots, but **not**
  the type-driven compiler — ts-morph stays for that.
- Adopting rolldown also sets up the dev server (§12): Vite = rolldown + the
  Environment API, so one stack covers both bundle and dev.
- **Validate at adoption:** confirm rolldown/tsdown stability + that the existing
  esbuild plugins (image/LQIP, ESM-externals, hydration inject) have rollup-plugin
  equivalents.

---

## 12. Dev server — native, in-process, HMR, runtime-agnostic

### The problem with today's dev

`pylon dev -c "node .pylon/server.mjs"` is a **wrapper that spawns the runtime's
start command**: chokidar watches → regenerate `.pylon` → **kill + respawn** the
child. Consequences:

- **Full process restart** on every edit (~1.7 s) — loses all warm state (DB pools,
  in-memory caches, WS connections).
- Regenerates the whole `.pylon` (server glue + client) per change.
- **Runtime coupling via the `-c` string** — node/bun/deno/workerd each need a
  different start command hand-wired.
- **No HMR.**

### The target: pylon owns the dev runtime

A **native** dev server that runs the app *in-process* (or in a managed worker) via
a **module runner**, with **server-side HMR** — re-evaluate only the changed
module(s) + dependents, keep the process and its warm state — and is
**runtime-agnostic**. No `-c` wrapper.

### Mechanism: Vite Environment API + module runner

Build `pylon dev` on **`vite/module-runner` + the Environment API** (Vite 6+):

- The **module runner** executes server modules with HMR (Vite's SSR-HMR, now
  runtime-agnostic). One module graph → one instance → fast partial updates.
- The **Environment API** defines a per-runtime environment (node in-process/worker,
  workerd via `@cloudflare/vite-plugin`, …) so the same app runs under the target
  runtime in dev.
- A **Pylon Vite plugin** owns the framework wiring: run the ts-morph pages analyzer,
  generate the typed client, wire `executeConfig → GraphQL handler → serve`, and
  declare HMR boundaries.
- Bonus: this **is** the rolldown adoption (rolldown-vite) — one stack for dev+build.

**Dev flow:** `pylon dev` boots a Vite dev server with the Pylon plugin; the module
runner loads the app entry (default export) in-process; Vite middleware serves
`app.fetch`. Edit a resolver/page → Vite invalidates just that module → the runner
re-evaluates it + dependents → the live Hono app picks up the new handler. **No
restart; DB pools/caches stay warm.**

### THE key risk: model registry across HMR

Models register via **import side-effects** (constructor/registration adds to a
global registry). On HMR re-run of a model module, registration must **replace by
stable key (class name), not duplicate** — otherwise you get duplicate models / a
stale schema. Design an explicit HMR accept-boundary that clears + re-registers the
module's models (and re-derives the schema). This is the single hardest part of
server HMR and must be designed up front, not discovered.

### server.mjs's role narrows

In **dev**, `.pylon/server.mjs` is **not** generated or run — the dev server owns
serving and injects the app via the module runner. `server.mjs` becomes a
**build/production-only** artifact. That deletes the `-c "node server.mjs"` wrapper
entirely; dev is native.

### Fallback

Keep the current spawn-and-restart as a legacy `pylon dev --no-hmr` mode for
runtimes without a Vite environment (or if a project hits an HMR edge case). The
module-runner path is the default.

> Scope note: this is a **meaty subproject, independent of the package
> consolidation** (§1–§10). Sequence it separately — consolidation doesn't need it,
> and it doesn't need consolidation.

---

## 13. Runtime targets — dev + build matrix

Pylon targets **Node, Bun, Deno, workerd (Cloudflare)**. The seam already exists:
the generated server glue **default-exports the fully-configured app** (`.fetch`)
and **conditionally binds `node:http` for Node** — Bun/Deno/workerd auto-serve the
default export. `pylon dev --runtime <node|bun|deno|workerd>` (default `node`)
selects the environment; the app code is identical across all four.

| Runtime | Dev | Build / deploy |
| --- | --- | --- |
| **Node** | Vite `node` env + module runner, in-process HMR | unbundled `.pylon/server.mjs` + **nft trace** → standalone; run `node server.mjs` |
| **workerd** | Vite `workerd` env (`@cloudflare/vite-plugin` / miniflare) — matches edge | **rolldown-bundle** app + default export → single worker module; Wrangler deploys (no node_modules at edge; nft N/A) |
| **Bun** | `bun --hot` on the app entry (Bun native HMR), or a Bun module-runner env | default export; `bun run` (Bun auto-serves) or a Bun-targeted bundle |
| **Deno** | `deno run --watch` / Deno env | default export; `deno serve` |

**Serving per runtime:** Node binds `node:http` (server-glue `__isNode` block);
Bun/Deno/workerd auto-serve the default-exported `app.fetch`. Nothing in user code
changes between targets.

**One-instance guarantee holds everywhere:** dev = the module runner controls the
graph; Node prod = `server.mjs` import (module cache); edge = the single worker
bundle scope. So the model registry stays a singleton across dev, Node, and edge.
