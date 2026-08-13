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
  /** The ONLY build-side hook. Called ONCE per build; returns a watch handle the
   *  Supervisor drives. Reads upstream stage outputs from `ctx.out`. */
  build?(ctx: BuildContext): Promise<BuildController>
}

/** Shared, readonly-to-plugins context passed to every build hook. */
interface BuildContext {
  readonly mode: 'build' | 'dev'
  readonly root: string        // cwd
  readonly srcDir: string      // <root>/src
  readonly outDir: string      // <root>/.pylon
  /** Run the app once in a runner to harvest runtime info. MEMOIZED per build →
   *  N callers share ONE subprocess spawn. */
  runInApp<T>(harvest: HarvestFn<T>): Promise<T>
  /** Upstream stage outputs, filled in as the pipeline advances. */
  readonly out: { sdl?: string; clientDir?: string }
}
```

Why this exact shape:
- `rebuild()` / `dispose()` is the minimal surface the Supervisor already needs — it
  currently pokes esbuild's `rebuild()`/`dispose()` by hand. An esbuild-backed
  controller is a two-line adapter over `esbuild.context()`; a rolldown-backed one
  wraps rolldown's watch API. **Both coexist.**
- `ctx` replaces ambient globals threaded through the bundler; `ctx.out.{sdl,clientDir}`
  gives `build` hooks ordered access to upstream stage outputs.

### Decision: NO schema-contribution hook (was `contributeIR`)

An earlier draft added a second hook (`contributeIR`) so the ORM could hand the
pipeline `PylonIR` to merge. **Rejected.** The ORM doesn't want to hand us IR — it
contributes to the schema by the user **registering models** (`new Pylon({db:{models}})`).
Construction registers them; a core stage just *harvests the registry*. So:

- **Schema contribution is a core backbone stage, driven by registration** — not a
  plugin hook. `PylonIR` never becomes a public API; plugins can't cause merge
  conflicts in it; the ORM has **no build hook at all** (just `setup` + models).
- The plugin build contract is therefore exactly **one** hook: `build → BuildController`.
- If a build-time *schema generator* plugin ever appears (nothing needs it today), it
  registers through a narrow API (`ctx.registerModels(...)`) that feeds the same
  harvest → schema path — never a parallel IR-merge lane.

### The pipeline

The build is a fixed backbone of stages; the sole plugin extension point is the
`artifacts` stage. Stage order is fixed (so `artifacts` always sees a ready
`sdl`/`clientDir`); `dependsOn` only orders plugins *within* the `artifacts` stage.

```
harvest    run app once → registered manifest (models, …)   [core; = schema contribution]
schema     type-introspection + manifest → SDL + resolvers  [core]
server     emit .pylon/server.mjs + transpile .pylon/src    [core]
client     typed client from SDL (only if schema changed)   [core]
artifacts  plugin BuildControllers, in dependsOn order       [PLUGINS: build → Controller]
```

```ts
async function runPipeline(ctx: BuildContext, plugins: Plugin[], ctrls: Map<Plugin, BuildController>) {
  const manifest = await ctx.runInApp(harvestManifest)               // harvest (core)
  const { typeDefs, resolvers } = new SchemaBuilder(ctx.srcDir).build({ manifest })  // schema (core)
  ctx.out.sdl = typeDefs
  await emitServerGlue({ typeDefs, resolvers, outDir: ctx.outDir })  // server (core)
  if (schemaChanged) ctx.out.clientDir = await buildClient({ sdl: typeDefs, outDir: ctx.outDir })  // client (core)
  for (const p of topoSort(plugins)) if (p.build) {                  // artifacts (plugins)
    let c = ctrls.get(p); if (!c) ctrls.set(p, (c = await p.build(ctx)))  // create once → holds watch state
    await c.rebuild()
  }
}
```

```ts
function useDatabase(opts): Plugin {
  return { name: 'database', setup(app) { /* bind connection/principal */ } }
  // NO build hook — models register via `new Pylon({db:{models}})`; the harvest picks them up.
}

function usePages(): Plugin {
  return {
    name: 'pages', strategy: 'last',
    setup(app) { /* mount SSR handler */ },
    async build(ctx) {                                                // ctx.out.{sdl,clientDir} ready
      const b = await createPageBundler({ pages: scan(ctx.srcDir + '/pages'), client: ctx.out.clientDir, outDir: ctx.outDir, mode: ctx.mode })
      return { rebuild: () => b.rebuild(), dispose: () => b.close() } // bundler (rolldown|esbuild) hidden behind the handle
    },
  }
}
```

**First commit changes no behaviour**: ship `BuildController` + `BuildContext`, make
the current esbuild call sites return controllers, make the harvest a named core
stage, and adapt the Supervisor to drive `runPipeline`. esbuild stays. Only then does
rolldown enter, one site at a time.

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

### Spike results — `build.js` on rolldown 1.2.4 (DEFERRED)

Ported `build.js` to rolldown as the first, isolated site. Invariants that HELD:
identical entry-file set, self-refs stay external, the **model-registry singleton is
preserved** (db/index + db/plugin share one chunk), `@/` resolves, and Tailwind CSS
is emitted correctly. Three gaps surfaced:

1. **CSS bundling removed** (`UNSUPPORTED_FEATURE`, rolldown #4271). Worked around by
   running PostCSS in a plugin `load` hook and `emitFile`-ing the result as an asset
   (`moduleTypes: {'.css':'js'}` so rolldown never parses it). ✅
2. **oxc externalizes runtime helpers** to `@oxc-project/runtime` (esbuild inlines);
   no inline option in 1.2.4. Needs it as a runtime dep — acceptable but a footprint
   change. ✅ once added.
3. **BLOCKER:** rolldown hoists `import {createRequire} from "node:module"` into the
   `dist/core/index.js` ENTRY; esbuild's core didn't carry it. Any browser consumer
   whose graph reaches core (the usePages page build does) then fails to resolve node
   built-ins. This is a tree-shaking/hoisting behavior difference, not a toggle.

**Verdict:** keep `build.js` on esbuild for now (behind the seam). Revisit rolldown
when #3 is addressable (upstream fix, or restructuring so core is never browser-
reachable — which the boundary guard below would also enforce). rolldown stays a
devDep as the tracked direction.

### Adjacent: enforce the self-ref boundary

The build's correctness depends on cross-*feature* imports using the self-ref
(`@getcronit/pylon/<f>`, externalized) rather than a relative path (`../auth/…`,
which would inline a feature into every consumer and break singletons). Add a
`check:boundaries` guard (a small src scanner, or dependency-cruiser) that fails when
a file under `src/<A>/` has a relative import resolving into a different `src/<B>/`.
Wire it into `typecheck`/CI. This also structurally prevents gap #3's "core reachable
from browser" class of problem.

## 5. Pillar 3 — native dev server

Today: `tsxRun` spawns `server.mjs` as a subprocess; every change kills the tree
(treekill) and respawns it; gqty regen retries against `/graphql` hoping it's up.
Full rebuild + full restart per keystroke-save, no fast-paths, boot races.

Target: the Supervisor owns a **long-lived dev runtime** it reloads *in place* via a
small IPC protocol, plus a change **classifier** that maps each edit to the cheapest
reload. The bundler work flows through the same `BuildController`s from §3.

### The runtime: a persistent worker with a reload protocol (recommended)

Run the app in one long-lived child (worker_thread / child_process) that stays up
across edits and exposes a `reload(kind)` IPC — instead of kill+respawn. Preferred
over pure in-process hosting because Node's ESM cache can't be cleanly invalidated in
the CLI's own process, and a worker gives a clean boundary for the singleton reset
below. (Pure in-process stays a fallback if the reset proves trivial.)

```ts
// worker (long-lived): loads the app, serves, and reloads on command
let handler                                   // the live Hono/Yoga fetch handler
async function boot() { handler = await importApp() ; announce('ready') }   // real readiness signal
onMessage(async ({ kind }) => {
  if (kind === 'schema') swapSchema(readSchema())          // re-read .pylon/schema.mjs into the live handler
  if (kind === 'app')    { resetRegistry(); handler = await importApp(bust()) }  // ⬅ singleton reset, then re-import
  if (kind === 'pages')  {}                                // SSR loads page bundles dynamically → nothing to re-import
  announce('reloaded')
})
```

### The Supervisor loop

```ts
watch(['src', 'pages', 'public', 'pylon.config.*'])
on(change => queue.run(async () => {                       // single-flight (keep the gen-guard)
  const kind = classify(change)
  if (kind === 'config') return worker.restart()           // plugins changed → clean re-init
  await runPipeline(ctx, plugins, ctrls, { only: stagesFor(kind) })   // §3 driver, sliced
  await worker.reload(kind)                                 // await the worker's 'reloaded' signal
  sse.push('reload')                                        // then tell the browser
}))
```

### Change → reload matrix

| Change | Pipeline stages re-run | Runtime reload |
| --- | --- | --- |
| `pages/**` | `artifacts` only (usePages controller.rebuild) | `pages` (SSR picks up new bundle) + SSE |
| `src/**` resolver, schema unchanged | `schema`→`server` (no `client`) | `app` (reset + re-import) + SSE |
| `src/**` model/type, schema changed | `harvest`→`schema`→`client`→`artifacts` | `app` + SSE |
| `public/**` | copy asset | SSE only |
| `pylon.config.*` | rebuild `ctrls` map | worker **restart** |

### Correctness constraint (the main risk)

The model-registry singleton + app-context must not duplicate across an `app`
reload. Today a fresh subprocess hides this; here the worker must `resetRegistry()`
**before** the cache-busted re-import, so re-registering models on construction is
idempotent. This reset boundary is the one thing to prove before committing Pillar 3.

### Fallback

The subprocess `-c` model stays for runtimes the worker can't emulate (Workers/Deno
edge) — `pylon dev -c "wrangler dev"` keeps working, just without the fast-paths.

## 6. Pillar 4 — one plugin pipeline for build + dev + runtime

The same `Plugin` object drives all three phases:
- `setup` / `middleware` — runtime wiring (unchanged);
- `build` → `BuildController` — one-shot build *and* dev watch (same instance);
- `strategy` / `dependsOn` — ordering, for both runtime `executeConfig` and the
  Supervisor's `artifacts`-stage sequencing.

Schema contribution is **not** a plugin concern — it's the core `harvest`+`schema`
stages, driven by what the app registered (§3). So the Supervisor is a generic
driver of `runPipeline` (§3): run the core stages, then `await controller.rebuild()`
for each `build` plugin in `dependsOn` order. usePages stops being special-cased —
it's just the `strategy:'last'` plugin whose controller happens to build pages, and
the ORM isn't in the build path at all.

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
- **Singleton reset across an `app` reload** (Pillar 3) — the registry/app-context
  must be reset before the worker's cache-busted re-import so re-registration is
  idempotent. **This is the gating spike for Pillar 3.** (Runtime decided: persistent
  worker + reload protocol, not pure in-process — see §5.)
- **`use-data-static-analyzer` port** — it's an esbuild `onLoad` transform doing
  cross-file useData analysis; the Rollup-hook port is the largest single task.
- **`new Function` `__resolveType`** (schema-parser) is orthogonal but edge-hostile
  (CSP); worth revisiting when we touch the glue, not required here.

## 9. Non-goals

- Changing the schema introspection (TS compiler API stays).
- Changing the unbundled `server.mjs` output contract.
- The nft "standalone" deploy artifact (separate RFC/track).
