# Pylon build / dev / plugin pipeline — rolldown + native dev

Replace esbuild with **rolldown** across the build, and replace the
spawn-and-restart dev loop with a **native, in-process dev server** — without
breaking the plugin API each time the bundler changes. The enabling move, agreed
up front, is to **decouple `Plugin.build` from esbuild** behind a bundler-agnostic
`BuildController` seam. Everything else is sequenced behind that seam so esbuild and
rolldown can coexist during the migration and nothing flips in a single risky jump.

Do this on its own branch, after the consolidation lands. Preserve behaviour at
every step (the dev loop and `pylon build` stay green between commits).

---

## 1. Current architecture (feat/v3-fullstack)

### Build — `pylon build`
`cli/index.ts` (`build`) → `cli/builder/index.ts` → `cli/builder/bundler/bundler.ts`.

| Stage | File | Tool |
| --- | --- | --- |
| Schema introspection → SDL + resolvers | `cli/builder/schema/builder.ts` (+ `schema-parser.ts`) | **TS compiler API** (no bundler) |
| Runtime glue (unbundled entry) | `cli/builder/bundler/emit-server-glue.ts` | string emit → `.pylon/{server.mjs,schema.graphql,schema.mjs,resolvers.js}` |
| Transpile app tree (build mode) | `cli/builder/bundler/transpile-app.ts` | **esbuild** → `.pylon/src/**` |
| Typed query client | `cli/builder/build-client.ts` | **esbuild** → `.pylon/client` |
| Pages (client + server bundles) | `pages/plugins/use-pages/build/index.ts` | **`esbuild.context()`** + ~7 esbuild plugins |
| DB CLI model loading | `cli/db/index.ts` | **esbuild** |

The server is **unbundled**: `server.mjs` imports your app (dev: `src/index.ts` via
the tsx loader; build: the transpiled `./src/index.js`), mounts the GraphQL handler
+ plugins, and serves. See `emit-server-glue.ts`.

### Dev — `pylon dev`
A single-flight Supervisor in `cli/index.ts`: on each change, the chain runs
`buildServer → (client if schema changed) → buildPages → restartServer`, guarded by
a generation counter. A chokidar watcher covers `src`/`pages`/`public`/
`pylon.config.*`. An SSE server on `PORT+1` pushes browser reloads. `tsxRun` spawns
`server.mjs` as a **subprocess** through tsx's loader; `restartServer` kills + respawns
it every change. **No HMR** — every change is a full process restart; page edits
reload the whole server; client (gqty) regen waits on a readiness poll.

### Plugins — `core/index.ts`
```ts
export type Plugin<…> = YogaPlugin<…> & {
  name?: string
  strategy?: 'first' | 'last'          // coarse phase vs the GraphQL handler mount
  dependsOn?: string[]                  // stable topo order within a phase
  middleware?: MiddlewareHandler<Env>
  setup?: (app: Pylon<any>) => Promise<void> | void
  build?: <T extends BuildOptions>(args: {   // ⬅ esbuild.BuildOptions
    onBuild: () => void
  }) => Promise<Omit<BuildContext<T>, 'serve'>>   // ⬅ esbuild.BuildContext
}
```
`executeConfig` runs plugins by `strategy` phase, topo-sorted by `dependsOn`.
usePages is a `strategy:'last'` plugin whose `build` returns an esbuild watch
context the Supervisor drives.

---

## 2. The problem

- **The bundler leaks into the public plugin contract.** `Plugin.build` returns an
  esbuild `BuildContext<T>` and takes esbuild `BuildOptions`. Any bundler swap is a
  breaking change to how every build-contributing plugin is written and driven.
- **Dev is spawn + full restart.** A whole `ts.Program` + rebundle + kill/respawn on
  every keystroke-save; boot races papered over with retry-and-hope; the
  `removeAllListeners()` + treekill dance is fragile; no page/schema/resolver
  fast-paths.
- **esbuild is everywhere** (six sites, §1). Migrating all at once is a big-bang
  risk; there is no seam to migrate one site at a time.

## 3. Pillar 1 — the `BuildController` seam (AGREED)

Redefine `Plugin.build` to return a **bundler-agnostic controller**, not an esbuild
context:

```ts
/** What the Supervisor needs from any build-contributing plugin, regardless of
 *  which bundler backs it. One instance serves BOTH one-shot build and dev watch. */
export interface BuildController {
  /** Re-run this plugin's build. Called by the Supervisor on a relevant change. */
  rebuild(): Promise<void>
  /** Release watchers/handles. Called on dev shutdown or before a fresh build. */
  dispose(): Promise<void>
}

export type Plugin<…> = YogaPlugin<…> & {
  name?: string
  strategy?: 'first' | 'last'
  dependsOn?: string[]
  middleware?: MiddlewareHandler<Env>
  setup?: (app: Pylon<any>) => Promise<void> | void
  build?(args: {
    mode: 'build' | 'dev'
    outDir: string
    /** Notify the Supervisor a rebuild finished (drives client-regen / reload). */
    onRebuild(result: { schemaChanged?: boolean }): void
  }): Promise<BuildController>
}
```

Why this exact shape:
- `rebuild()` / `dispose()` is the minimal surface the Supervisor already needs — it
  currently pokes esbuild's `rebuild()`/`dispose()` by hand. An esbuild-backed
  controller is a two-line adapter over `esbuild.context()`; a rolldown-backed one
  wraps rolldown's watch API. **Both coexist.**
- `mode`/`outDir` replace ambient globals threaded through the bundler.
- `onRebuild({schemaChanged})` replaces the current schema-diff bookkeeping that
  couples client regen to the bundler internals.

**This is the first commit and it changes no behaviour**: ship the interface, adapt
the existing esbuild call sites to return a `BuildController`, adapt the Supervisor
to drive it. esbuild stays. Only then does rolldown enter, one site at a time.

## 4. Pillar 2 — rolldown as the bundler

Migrate the six esbuild sites behind the seam, ordered by risk:

1. **`build.js` (the package's own build)** — most isolated; validates the three
   parity questions before touching user-facing builds.
2. **`transpile-app.ts` + `build-client.ts`** — single-entry-ish, no exotic plugins.
3. **usePages page build** — the hard one: port the esbuild plugins
   (`postcss`, `image`, `external-esm`, `inject-app-hydration`, `buildAppFile`,
   `writeOnEnd`, `use-data-static-analyzer`, `preserveRelativeWithExt`) from
   esbuild's `onResolve`/`onLoad`/`onEnd` to rolldown's Rollup-style
   `resolveId`/`load`/`transform`/`generateBundle` hooks.
4. **`cli/db`** — model-loading bundle; small.

**Three parity risks, verified by spikes before committing to each site:**

| Risk | Why it matters | Spike |
| --- | --- | --- |
| **Decorators + `emitDecoratorMetadata`** | The ORM authors models with legacy decorators; esbuild used `esbuild-plugin-tsc` for metadata. rolldown transforms via **oxc**, which handles decorators differently. | Build a model class through rolldown; assert the registry + column metadata survive. **Make-or-break.** |
| **CSS / PostCSS / Tailwind** | `pages/index.css` is processed through PostCSS + Tailwind and emitted at `dist/pages/index.css` (an `exports` subpath). | Emit the pages CSS through rolldown; assert byte-equivalent Tailwind output at the right path. |
| **Watch / incremental** | Dev needs fast rebuilds without a fresh `ts.Program` + full rebundle each save. | Drive rolldown's watch API through a `BuildController`; measure rebuild latency vs esbuild. |

If a spike fails, that site keeps its esbuild-backed `BuildController` — the seam
means partial migration is a supported end state, not a broken one.

## 5. Pillar 3 — native dev server

Replace `tsxRun` + spawn + full restart with a dev runtime the CLI **hosts
in-process** (or a single persistent worker with a real readiness signal), fed by
rolldown watch through the plugin `BuildController`s.

- **Readiness signal** replaces the gqty retry-and-hope: the in-process server
  announces "listening" directly; no port polling.
- **Tiered fast-paths** instead of one full restart:
  - *schema change* → rebuild schema + swap it into the live handler;
  - *resolver/app change* → invalidate + re-import just that module graph;
  - *page change* → rebuild the page bundle + reload its SSR artifact, push SSE;
  - *config/plugin change* → the one case that still does a clean full re-init.
- **No treekill dance** — one process, module invalidation instead of kill/respawn.
- **Correctness constraint**: the model-registry singleton and app-context must
  survive module invalidation (today they survive because the subprocess is fresh
  each time). The in-process design must invalidate at the right graph boundary or
  reset the registry deterministically on reload. This is the main open risk here.

The subprocess model stays available as a fallback for runtimes the in-process host
can't emulate (Workers/Deno edge) — `pylon dev -c "wrangler dev"` keeps working.

## 6. Pillar 4 — one plugin pipeline for build + dev + runtime

The same `Plugin` object drives all three phases:
- `setup` / `middleware` — runtime wiring (unchanged);
- `build` → `BuildController` — one-shot build *and* dev watch (same instance);
- `strategy` / `dependsOn` — ordering, for both runtime `executeConfig` and the
  Supervisor's build sequencing.

The Supervisor becomes a generic driver: topo-sort the `build`-contributing plugins,
`await controller.rebuild()` in order on the relevant change, `onRebuild` fan-out
decides client regen / SSE. usePages stops being special-cased — it's just the
`strategy:'last'` plugin whose controller happens to build pages.

## 7. Migration sequence

1. **BuildController seam** — new interface; esbuild call sites return controllers;
   Supervisor drives them. No behaviour change. *(gate: full e2e green)*
2. **`build.js` → rolldown** — de-risk decorators/CSS/splitting in isolation.
3. **`transpile-app` + `build-client` → rolldown.**
4. **usePages page build → rolldown** — port the plugins.
5. **Native dev server** — in-process runtime + fast-paths on top of the seam.
6. **Delete esbuild** — once every controller is rolldown-backed.

## 8. Risks & open questions

- **Decorators/metadata under oxc** — spike #1; if it fails, transpile-app stays on
  esbuild indefinitely (acceptable via the seam).
- **In-process dev + singleton invalidation** — the model registry / app-context
  must not duplicate or leak across reloads. Needs a deterministic reset boundary.
- **`use-data-static-analyzer` port** — it's an esbuild `onLoad` transform doing
  cross-file useData analysis; the Rollup-hook port is the largest single task.
- **`new Function` `__resolveType`** (schema-parser) is orthogonal but edge-hostile
  (CSP); worth revisiting when we touch the glue, not required here.
- **Open:** in-process host vs persistent worker for dev — decide at Pillar 3 after
  the watch spike shows rebuild latency.

## 9. Non-goals

- Changing the schema introspection (TS compiler API stays).
- Changing the unbundled `server.mjs` output contract.
- The nft "standalone" deploy artifact (separate RFC/track).
