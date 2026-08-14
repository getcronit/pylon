# RFC: Build / Dev / Deploy Pipeline — reload-aware runtime + persistent dev worker + nft standalone

**Status:** Steps 0–1 DONE. Step 2 next.
**Scope:** the dev loop, the production artifact, and the invariant that ties them together.
**Supersedes/extends:** `rfcs/BUILD_DEV_PIPELINE.md` (Pillars 1–2, done; this is Pillar 3 + deploy).

---

## 1. Context (grounded in the code)

**A restart re-runs everything.** `cli/index.ts:646` keeps a stable CLI (watcher + SSE + build Supervisor) but the app is a child process that is **SIGKILL'd and respawned on every edit** (`restartServer`, `:688`). Each boot of `server.mjs` (`emit-server-glue.ts`) does: import raw `src/index.ts` via tsx (transpiles the whole graph) → `executeConfig` 'first' (`pylon-handler.ts:102`) = `installBasePipeline` + `realize` + **every plugin `setup()`** (DB connect, identity, queues) → mount Yoga → `executeConfig` 'last' (usePages catch-all) → bind the port. DB connect, plugin setup, tsx re-transpile, and port bind are redone for a CSS tweak.

**The build side is already cheap.** In dev, `buildServer` (`bundler.ts:127`) is warm schema-gen (**25ms measured** — the SchemaBuilder already reuses a warm TS program via `tsState`, `builder.ts:31/252`) + writing 4 glue files. `buildPages` is the rolldown rebuild (~300–600ms). **The ~1.7s/edit is the restart, not the build.**

**Deploy has no artifact.** `index.ts:854`: *"no bundling — ship the unbundled `.pylon/**` + the whole `node_modules`, run `node server.mjs`."* Heavy, not serverless/edge-friendly. `pylon build` emits no self-contained deploy dir.

## 2. Insight: durable vs. swappable

A running server has **durable** state (Pylon Hono instance, base pipeline, DB connection, identity, queues, port, SSE — expensive, rarely changes) and **swappable** state (pages routes/manifest, schema+resolvers, config). Today every edit rebuilds *all* of it. The optimum keeps durable state alive and swaps only what changed.

## 3. Design

### 3.1 Reload-aware runtime — static boot vs. dev worker

Refactor `server.mjs`'s inline wiring into a **static boot** whose swap points are mutable refs behind operations:
- `mountGraphql(app, getSchema)` — Yoga mounted once with a schema **getter** (ref), so schema swaps update the ref (Yoga `replaceSchema`/factory). *(Step 2 seam.)*
- usePages catch-all reads mutable `routes`/`handler`/`manifest` refs; a `reloadPages()` re-reads manifests + re-imports the (content-hashed → cache-clean) SSR routes into the refs. *(Step 0/1 seam.)*

**Two entries, not one.** `emit-server-glue` keeps emitting a **pristine, statically-traceable `server.mjs`** (prod: refs set once, never swapped, behavior identical). The dev command runs a **separate dev-worker** that imports the same static boot and adds the reload driver (IPC listener, change classification, cache-bust re-import). The dev machinery is *never* in the prod artifact.

### 3.2 Persistent dev worker + reload protocol

- The CLI (Supervisor) stays the stable process (watcher + SSE + build orchestration).
- The app runs in a **persistent worker** (child process, tsx loader — today's `server.mjs`, kept alive), spawned **once**, with an **IPC channel** (`index.ts:922` gains `'ipc'`).
- Reload channel: IPC `{reload: kind}` CLI→worker → worker applies the minimal swap + acks → CLI SSE-notifies the browser.

**Reload kinds** (grounded in the seams):

| Kind | Trigger | Build slice | Worker action | Difficulty |
|---|---|---|---|---|
| `pages` | edit in `pages/`·`public/` (or a pages-only component) | `buildPages` only | `reloadPages()` — re-read manifests + re-import hashed SSR routes into the ref; no app re-import, no DB reconnect | **Low** (cache-clean) |
| `server` | `src/` edit (schema may change) | `buildServer`(+client if schemaChanged)+`buildPages` | cache-bust re-import app + `replaceSchema`; **registry reset** | **Medium** (spike) |
| `config` | `pylon.config.*` | full | **worker restart** (today's path) | trivial |

### 3.3 Workstream D — production artifact (nft standalone)

`pylon build` (default or `--standalone`) runs **`@vercel/nft`**: trace `server.mjs` → the minimal `node_modules` subset, **plus explicitly include** `.pylon/__pylon/**` (page bundles, client, manifests, static assets) and the transpiled `.pylon/src/**`. Emit a self-contained deploy dir (Next `output: standalone` pattern).

**Why nft, not ncc:**
1. **Native deps** — `sharp` (^0.33.5, native libvips `.node`) can't be folded into a single JS bundle by ncc; nft traces `.node` binaries + platform assets and includes them.
2. **Dynamic imports** — the prod graph loads pages via a *computed* specifier (`setup/index.tsx:102/132/424`), which neither tool can *follow*; nft's model (trace static graph + explicitly add files) fits, ncc's (bundle) does not.
3. **The transpile-only build** (Pillar 2) is the natural nft input — a clean, unbundled static ESM graph. ncc would re-bundle what we deliberately kept unbundled. **transpile-only build → nft standalone is one coherent story.**

### 3.4 The invariant tying dev and deploy together

> **The prod `server.mjs` is a minimal, statically-traceable boot. All reload machinery lives in a separate dev-only worker entry that is never traced or deployed. Dynamic loading of build-output artifacts (pages) is handled by nft's explicit-include, not by following imports.**

Note the pages dynamic imports already make a naive `nft(server.mjs)` incomplete *today* — the explicit-include is required regardless; the dev rework must not make it worse.

## 4. Roadmap (each step shippable + measurable)

- **Step 0 — reload seam / static-boot split** ✅ *(commit 727c8ff)*. usePages `loadPages()` populating mutable `routes`/`handler`/`manifest` refs + a dormant dev hook (`globalThis.__PYLON_DEV_RELOAD_PAGES__`). Behavior-identical; prod entry stays traceable.
- **Step 1 — persistent worker + pages hot-swap** ✅ *(commit e0203f8)*. dev emits `dev-worker.mjs` (imports pristine `server.mjs` + IPC reload listener); the CLI spawns ONE worker with IPC, classifies changes, and `pages` → `buildPages` + `reload:pages` → in-worker `loadPages()` → SSE (no restart), `server`/`config` → restart. **Proven:** page edit keeps the SAME worker pid, src edit gets a NEW pid; dev-pages-loop page-edit **1518ms→514ms (~3×)**, out-of-`pages/` component **3042ms→1067ms**; prod path unaffected.
- **Step 2 — schema/resolver hot-swap.** Registry-idempotency spike + Yoga `replaceSchema` + cache-bust app re-import. Removes the restart for `src` edits.
- **Step 3 — (later) Tier-2 on-demand + Fast Refresh** on a rolldown-vite foundation. Vite-class end state; prototype-de-risked (see §6).
- **Workstream D — nft standalone deploy** (parallel to 1–2; depends only on the §3.4 invariant).

## 5. Risks / spikes (named to code)

- **Registry idempotency** (Step 2) — `db/registry.ts:552` `registerModelDefinition`, `queues/queue.ts` `registeredQueues`, `db/abilities.ts:227`. Reset-before-reimport vs. replace-by-name.
- **Yoga schema-swap** — handler builds Yoga with a fixed closure schema (`pylon-handler.ts:272-292`); needs the getter seam; verify Yoga re-reads.
- **Change classification** — dir conventions first; shared `components/`·`lib/` files default to `server` (correct, not maximally fast) until the import graph is wired.
- **Error resilience** — a failing reload keeps last-good serving + surfaces to the browser overlay (mirror `index.ts:695`).
- **nft trace completeness** — dynamic pages imports + `sharp` native assets; validate the standalone dir boots with `node_modules` pruned.

## 6. Measurements (from the `spike-dev-tier2/` prototype)

On-demand analyzer transform: **8.6ms cold / 0.8ms warm**; warm cache hit = 0 work; HMR client re-import + re-render **6–29ms**; save→in-place browser update **<50ms warm** (verified live — the compiled GraphQL document recompiled with no reload). Compiler plane: **832ms cold one-time / ~25ms warm** per edit (already implemented via `tsState`). These confirm Tier-2's client plane is viable and the compiler is not the bottleneck — the restart is.
