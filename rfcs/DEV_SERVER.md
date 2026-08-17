# RFC: Build / Dev / Deploy Pipeline — reload-aware runtime + persistent dev worker + nft standalone

**Status:** Steps 0–2 DONE. Engine: **full rolldown-vite** (see §3.0). Step 3 (client + pages/SSR on Vite) next.
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

### 3.0 Engine: full rolldown-vite (decided)

The recommended way to hot-reload a server without a restart is a real module runtime with
precise module-graph invalidation — the Vite `ssrLoadModule` / Environment-API `ModuleRunner`
model that every SSR framework uses. We adopt it wholesale as the **dev-time engine**
(rolldown-vite = Vite powered by rolldown, so the bundler story stays rolldown end-to-end).
Prod is unaffected: `pylon build` keeps emitting the pristine transpile-only `server.mjs` → nft
(§3.3). **Vite is dev-only and never enters the prod artifact.**

**Load-bearing mechanism (spiked, §6.1 — all green on vite@8):** a Vite dev server in
middleware mode with the framework marked `ssr.external: ['@getcronit/pylon', …]`. Then
`server.environments.ssr.runner.import(entry)`:
- **re-executes** the app graph on invalidation → fresh resolver closures, while
- keeping `@getcronit/pylon` a **single durable Node instance** → the registry, DB
  connection, identity, queues, ALS and bound port all survive the swap, and
- the name-keyed **registry idempotency** (already added to `db/registry.ts`) stops model
  accumulation across reloads.

So the server-plane hot path is: `src` edit → re-run the (warm, 25ms) SchemaBuilder for fresh
`typeDefs` → `runner.import(entry)` for fresh `graphql` → `__PYLON_DEV_SWAP_SCHEMA__(typeDefs,
graphql, resolvers)` (the seam in `pylon-handler.ts`). No process restart.

### 3.1 Dev topology

One dev process hosts **Vite (middleware mode) + the durable Pylon app + the compiler**.
Vite owns file watching, the module graph, client transform + HMR (its own ws), and SSR module
loading via the runner. `executeConfig` (DB connect, plugins, port bind) runs **once** at boot;
thereafter only the swappable slices change:

| Kind | Trigger | Action | Restart? |
|---|---|---|---|
| `client`/`pages` | edit in `pages/`·`public/` or a page component | Vite HMR (ws) → browser re-imports the changed module; analyzer plugin recompiles the GraphQL doc; SSR re-imports via the runner | no |
| `server` | `src/` edit (schema may change) | warm SchemaBuilder → `typeDefs`; `runner.import(entry)` → fresh `graphql`; `swapSchema` | no |
| `config` | `pylon.config.*` | durable plugin graph changed → tear down + reboot the dev process | yes |

This subsumes Step-1's IPC `reload:pages`/`reload:server` and the CLI's chokidar+SSE+classify
into Vite's native machinery; those get removed in Step 4.

### 3.2 Prod entry stays pristine

`emit-server-glue` keeps emitting a **statically-traceable `server.mjs`** with refs set once and
never swapped — prod behavior is identical and Vite-free. All reload machinery lives in a
**dev-only engine module** that prod never imports or traces.

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
- **Step 2 — server plane on Vite (the no-restart-on-`src`-edit win).** ✅ `swapSchema` seam (`pylon-handler.ts`) + registry idempotency (`db/registry.ts`) + a dev-only engine (`cli/dev/vite-hot-server.ts`, exported as `@getcronit/pylon/dev-engine`) that stands up a rolldown-vite dev server (middleware mode, `ssr.external`=framework) in the persistent worker. The generated `dev-worker.mjs` warms the runner and, on IPC `reload:server`, re-runs SchemaBuilder → `runner.import(entry)` → `swapSchema` (on schema change also regens client+pages and swaps them). CLI `sync()` routes `src` edits to `reloadWorker('server')` (fallback restart on failure). **Proven** (`dev-pages-loop.e2e` — 7/7): a `src` edit keeps the SAME worker pid for BOTH resolver-only and schema-changing edits; resolver-only hot-swap ~506ms (vs Step-1 src restart). Prod path untouched (Vite only in the dev-only `dev-worker.mjs`/`dev-engine`, never in `server.mjs`).
- **Step 3 — client + pages/SSR on Vite.** Move page-module loading + SSR to the runner (unify `reloadPages` with `runner.import`); analyzer becomes a Vite plugin; Vite's HMR ws replaces the SSE live-reload; Fast Refresh for pages. Remove the rolldown **dev** page build (prod build stays). **Sub-stages:**
  - **3a — analyzer as a Vite plugin.** ✅ `useDataStaticAnalyzerVite` (`enforce:'pre'`, `transform(code,id)`, strips `?query` suffixes / skips `\0` virtual ids) added next to the rolldown adapter; the bundler-agnostic core is unchanged. **Validated** (`spike-dev-tier2/analyzer-vite/`) through a real Vite `transformRequest`: `useData()` lowered to `useData(__pylonDoc,()=>({v0:id}))`, the compiled document survived, and Vite's SSR transform ran AFTER (proving the `pre` ordering).
  - **3b.0 — serving as a config plugin (pure entry).** ✅ Killed the `if(__isNode) serve` auto-serve smell: the built entry is now PURE (`export default app`, no import side effect, no runtime-sniffing). Serving is explicit + app-owned — `useNodeServer()` (`plugins/use-node-server.ts`, exported from core) is a dev-aware `'last'` plugin: binds `@hono/node-server` in prod, NO-OPs under `pylon dev` (the dev worker owns serving). Bun/workerd/Deno auto-serve the default export. Migrated all 15 serve fixtures + the docs app; added `@hono/node-server` as a dep. This dissolves the "avoid the glue" concern — the dev worker owns dev serving because serving is explicit everywhere. **Validated**: `compose-routes-serve` (5/5, prod `node server.mjs`), `dev-pages-loop` (7/7), and the real **docs app** (`pylon dev` → pages render + graphql, no spurious ws warnings).
  - **3b — client-only Vite for Fast Refresh (the "clean split")** ✅ **DONE + validated on the real docs app.** *Reworked from an earlier SSR-via-Vite attempt that accumulated workarounds (504 optimize churn, FOUC/CSS-inline dance, stylesheet-precedence, duplicate-context) — all symptoms of making Vite do SSR against Pylon's "React renders the whole document" model.* The clean split confines Vite to ONE job: serving the browser's client modules with React Fast Refresh. **SSR, serving and CSS stay on the Step-1 rolldown+Hono path, untouched** (rolldown manifest CSS `<link precedence>` → styled first paint, no FOUC; `loadPages` reads manifests + imports the hashed SSR bundle). `createPagesDevServer` (client-only) fronts the port in middleware mode: Vite serves `/pages/*`, `/@vite`, `/@react-refresh`, the HMR ws; everything else → `app.fetch` (graphql + the rolldown SSR catch-all). The bridge exposes only `clientEntry` (bootstrapModules → the Vite `app.tsx`) + `transformHtml` (inject `@vite/client` + the refresh preamble). Same `app.tsx` source SSR'd (rolldown) and hydrated (Vite) → structure matches. `resolve.dedupe` + `cacheDir` + `optimizeDeps.include` keep it a standard, stable client-Vite. **Live-validated on docs**: styled first paint (no FOUC), full hydration, no console errors, **React Fast Refresh** (edit → in-place, state preserved), `dev-pages-loop` **7/7**. Reverted the SSR-Vite machinery: `ssrLoadRoutes`, `collectCss`/SSR-CSS-inline, `__PYLON_MANIFEST__` blanking, before-boot ordering. Deps: `@vitejs/plugin-react-oxc`, `vite-tsconfig-paths`. Note: a `<link rel="stylesheet">` in a root layout needs a React-19 `precedence` prop (hydrate-`document` requirement, bundler-independent) — worth documenting.
  - **~~3b (superseded)~~ — Vite-fronted dev serving + SSR-via-runner** (earlier attempt, reverted; see above). `startPagesDevServer` (`pages/plugins/use-pages/dev/vite-dev-server.ts`, exported `@getcronit/pylon/pages/dev`) stands up the Topology-A server: `http.Server → vite.middlewares → getRequestListener(app.fetch)`, plugins `[tsconfigPaths, react-oxc, useDataStaticAnalyzerVite, injectHydrationVite]`, `ssr.external:['@getcronit/pylon']`. It sets a `globalThis.__PYLON_PAGES_DEV__` bridge that `setup/index.tsx` reads to branch four dev seams: routes ← `ssrLoadModule(app.tsx)`, bootstrap ← the Vite client entry, HTML ← `transformIndexHtml`, and `__PYLON_MANIFEST__={}` (Vite injects CSS). The generated `dev-worker.mjs` fronts the port via this when `.pylon/app.tsx` exists (usePages), else plain-serves. The Step-2 module runner gets `ws:false` so only the pages server owns the HMR ws (port 24678). **Live-validated on docs**: SSR renders real content (tsconfig `@/` paths resolved via `vite-tsconfig-paths`), hydrates, graphql falls through to `app.fetch`, **React Fast Refresh** reflects a component edit in-place with window state preserved (no reload), zero errors/warnings. Regression-clean: `dev-pages-loop` **7/7** on the now-Vite-fronted path. Deps added: `@vitejs/plugin-react-oxc`, `vite-tsconfig-paths`. **Topology proven** (`spike-dev-tier2/topology-a/`, live browser test): `http.Server → vite.middlewares(req,res, () => getRequestListener(app.fetch)(req,res))` — Vite serves client modules + `/@react-refresh` + HMR ws (its own default port, no socket-sharing needed); SSR renders via `ssrLoadModule` + `transformIndexHtml` (auto-injects the client + refresh preamble); `/api/ping` falls through to Hono's `app.fetch`. **React Fast Refresh confirmed live**: edit → marker updated in place, `useState` count preserved (6→6), same DOM node (no reload). In dev the worker serves the port through Vite (middleware mode): Vite handles `/@vite`, client modules, CSS/Tailwind natively, React Fast Refresh + its HMR ws; a fallback middleware bridges to `app.fetch` (graphql + the SSR catch-all). The usePages catch-all gets dev branches at the four seams the SSR map identified — `loadPages` routes → `runner.import` of the generated `app.tsx`; `/__pylon/static/*` → Vite; `bootstrapModules` → Vite client entry (+ `@vite/client`); CSS `<link>`s → Vite-injected. Both client + SSR use the SAME Vite-transformed sources (no hydration drift). Prod SSR path (manifest + hashed bundles, Web-standard render) stays byte-for-byte.
  - **3c — retire the dev page build + SSE.** In dev, drop `buildPages`/`buildClient` + the SSE reload server (Vite subsumes them); prod `pylon build` keeps the rolldown page build untouched. Fold `reload:pages` into Vite HMR.
  - **Runtime invariant (answers "any runtime / CF Workers"):** Vite is dev-only and Node-hosted (dev already was, via tsx). Prod multi-runtime is a property of the traceable `server.mjs` (Node http · Bun/workerd/Deno `export default app`) and is untouched. usePages SSR is Node/Bun-oriented *today* (fs manifests + import-by-path at boot) independent of Vite; the request-time render is already Web-standard. Edge-fidelity dev stays available via `wrangler dev` on the built artifact (optionally `@cloudflare/vite-plugin` later — additive).
- **Step 4 — consolidate.** Remove the now-subsumed dev machinery (chokidar-for-`src`, SSE server, IPC `reload:*`, `classify`); dev = supervise one Vite+app process, watch only `pylon.config` for restart.
- **Workstream D — nft standalone deploy** (parallel; prod stays transpile-only rolldown + nft; Vite is dev-only, so §3.2/§3.4 hold unchanged).

## 5. Risks / spikes (named to code)

- **Registry idempotency** (Step 2) — `db/registry.ts:552` `registerModelDefinition`, `queues/queue.ts` `registeredQueues`, `db/abilities.ts:227`. Reset-before-reimport vs. replace-by-name.
- **Yoga schema-swap** — handler builds Yoga with a fixed closure schema (`pylon-handler.ts:272-292`); needs the getter seam; verify Yoga re-reads.
- **Change classification** — dir conventions first; shared `components/`·`lib/` files default to `server` (correct, not maximally fast) until the import graph is wired.
- **Error resilience** — a failing reload keeps last-good serving + surfaces to the browser overlay (mirror `index.ts:695`).
- **nft trace completeness** — dynamic pages imports + `sharp` native assets; validate the standalone dir boots with `node_modules` pruned.

## 6.1 Server-plane proof (`spike-dev-tier2/server-plane/`, vite@8)

The load-bearing assumption for §3.0, spiked in isolation (fake framework `fw` marked
`ssr.external` + an app module that flips `v1`→`v2`). **All green:** (1) app module
re-executes with the fresh value on invalidation; (2) `fw` stays a single durable instance
(boot counter 1→1) — so DB/registry/ALS/port survive; (3) registry does not accumulate across
reloads (name-keyed idempotency); (4) fresh closures are distinct functions. Vite@8 exposes the
modern `environments.ssr.runner` (ModuleRunner) — that is the API used.

## 6. Measurements (from the `spike-dev-tier2/` prototype)

On-demand analyzer transform: **8.6ms cold / 0.8ms warm**; warm cache hit = 0 work; HMR client re-import + re-render **6–29ms**; save→in-place browser update **<50ms warm** (verified live — the compiled GraphQL document recompiled with no reload). Compiler plane: **832ms cold one-time / ~25ms warm** per edit (already implemented via `tsState`). These confirm Tier-2's client plane is viable and the compiler is not the bottleneck — the restart is.
