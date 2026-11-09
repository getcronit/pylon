# Project Loader — Target Architecture

**Status:** proposed · **Owner:** platform · **Supersedes:** the bundle-based `loadProjectApp`

One-line: replace the in-process **bundle-and-import** loader with a **project-context child runner**, so the CLI reads the project's real modules — which makes per-app migrations *zero-config* and deletes the bundle/strip/shim machinery.

---

## 1. Goal

**Primary:** an app declares nothing about where its migrations live; they default to the app's own folder.

```ts
// src/apps/blog/index.ts — no migrations line
export const blog = new Pylon({name: 'blog', db: {models: [Post]}})
// → migrations resolve to src/apps/blog/migrations, automatically
```

An explicit `db.migrations` remains as an override for non-standard layouts.

**Secondary (the enabler, and the real prize):** stop bundling the user's app to introspect it. That removes an entire class of "works differently under the loader than at runtime" bugs (`import.meta`, `__dirname`, stack traces, `require.resolve`) and deletes the strip-serve transform, the temp-file dance, and the `import.meta` shim.

### Non-goals
- Changing the authoring surface (`new Pylon`, `models.app`, migration files) beyond making `db.migrations` optional.
- Changing the runtime/serving path (`.pylon` bootstrap). This is about the **build/CLI-time** loader only.

---

## 2. Background — how loading works today

`loadProjectApp(cwd, entry)` ([packages/pylon-dev/src/project-bridge.ts](packages/pylon-dev/src/project-bridge.ts)):

1. Reads the entry source, `prepareModelSource` **strips `serve()`** and rebinds `export default`.
2. `esbuild.build` **bundles** that stripped source + `export * from '@getcronit/pylon-db'` (+ queues) into one temp `.mjs` at the project root.
3. `import()`s that temp file **in the pylon-dev process** and returns a `ProjectApp` of **live objects** — `MigrationRunner`, `connect`, `appGroups`, `schemaDrift`, `toIR`, …

It exists for two reasons, both real:
- **Strip serve** so importing doesn't boot a server.
- **Instance unification.** pnpm can resolve *two physical copies* of `@getcronit/pylon-db` — one for pylon-dev, one for the project. The models register into the project's copy; the CLI must read *that* registry. The bundle guarantees it by re-exporting the ORM from the same module the models registered into.

Consumers:

| Consumer | Path | Wants |
| --- | --- | --- |
| `pylon inspect` / `mcp` | `loadProjectApp` → `toIR()` | **data** (AppModel/IR) |
| `pylon build` | `loadAppContribution` → `PylonIR` | **data** (IR) |
| `pylon verify` | build + introspect | **data** (verdict) |
| `pylon db <cmd>` | `loadProjectApp` → live ORM | **live ORM + DB access** |

`loadAppContribution` already returns serializable `PylonIR` — build/inspect/verify fundamentally want *data*, not live objects. Only `db` needs live behavior.

---

## 3. Why the current design blocks the goal

To default migrations to `<app-dir>/migrations`, the system must learn each app's **source directory** automatically — captured at `new Pylon({name})` from the call site (stack trace or `import.meta`).

Bundling flattens every module into one temp file, so **both the stack trace and `import.meta` point at the temp file, not `src/apps/blog/index.ts`.** Auto-detection is impossible under the bundle. The shim (rewriting `import.meta.*` per file) makes an *explicit* `path.join(import.meta.dirname, …)` resolve, but it cannot remove the declaration — the constructor still has no way to know its caller.

**Zero-config genuinely requires the bundle to go.**

---

## 4. Design principles

1. **Execute the project's real modules, in the project's context.** No source rewriting, no flattening — what the CLI sees is what runs.
2. **Parent = UX, child = execution.** The pylon-dev CLI owns flags, output, and formatting. A child owns loading and running against the project.
3. **Data across the boundary where possible; execute-in-child where not.** Introspection returns JSON; stateful DB commands run entirely in the child.
4. **One instance, by resolution not by bundling.** The child resolves `@getcronit/pylon-db` from the project, so the entry and the command logic share it for free.

---

## 5. Proposed architecture — the project runner

A small **child entrypoint** shipped in pylon-dev, executed via the bundled `tsx` with `cwd = projectRoot`:

```
pylon-dev CLI (parent)                        project runner (tsx child, cwd=project)
──────────────────────                        ────────────────────────────────────────
spawnProjectRunner(cwd, op, args)  ── spawn ▶  1. resolve project @getcronit/pylon-db
                                               2. import(entry)  → registers models,
   ◀── JSON result + streamed logs ──             captures each app's source dir
                                               3. dispatch `op`:
                                                    introspect → serialize IR → stdout(JSON)
                                                    db <cmd>   → run against DB → stdout(JSON)
format for the user (consola)                  4. exit code
```

### 5.1 Instance unification without a bundle

The child resolves the ORM **from the project**, so it is the same physical module the entry registers into:

```js
// in the child, cwd = projectRoot
const dbUrl = pathToFileURL(require.resolve('@getcronit/pylon-db', {paths: [projectCwd]}))
const orm = await import(dbUrl.href)          // MigrationRunner, connect, appGroups, …
await import(pathToFileURL(entryAbs).href)    // registers models INTO orm's registry
```

Both resolve from `projectCwd/node_modules` → one instance → one registry. This is the mechanism the bundle's `export *` was faking.

### 5.2 Two operation modes

- **`introspect`** (inspect, build, verify, mcp): after import, call `orm.toIR()` / build the AppModel, `JSON.stringify` to a **result channel**, exit. Parent parses and does all rendering (SDL/DDL/verdict) and, for build, feeds the IR to `SchemaBuilder`.
- **`db <command>`** (migrate/deploy/diff/…): the command runs **in the child**, where the live ORM + `DATABASE_URL` + real migration files exist. It returns the existing `DbCommandResult` (already plain data) as JSON; per-app progress is emitted as log lines. Parent formats with consola exactly as today.

### 5.3 Output protocol

- **stderr** — human logs (streamed to the user live).
- **fd 3** (or a stdout sentinel block) — a single JSON envelope: `{ ok, result?, error? }`.
- **exit code** — 0 / non-zero, mirrored by the parent.

Using a dedicated fd keeps the machine channel clean regardless of what the user's code prints.

### 5.4 Serving on import

v3 entries are `export default new Pylon(...)` — **serving is a boot-time config plugin**, not a top-level call, so a plain import is side-effect-free (verified: e2e `apps-app`, `runtime-app`). The strip-serve transform is legacy. Defense: the child sets `PYLON_INTROSPECT=1`; the serve plugin/bootstrap treats it as a no-op. No source rewriting needed.

---

## 6. Zero-config migrations — source-dir capture

### 6.1 Capture at construction

The `Pylon` constructor records the **caller's file** using V8 structured stack frames (not string parsing):

```ts
function callerDir(): string | undefined {
  const prep = Error.prepareStackTrace
  Error.prepareStackTrace = (_, frames) => frames
  const frames = new Error().stack as unknown as NodeJS.CallSite[]
  Error.prepareStackTrace = prep
  for (const f of frames.slice(1)) {
    const file = f.getFileName()
    if (!file || file.includes('node_modules') || isPylonPackage(file)) continue
    return path.dirname(fileURLToPath(file))    // the app's own directory
  }
}
```

Stored on the instance (`this.#sourceDir`). Because the child runs the **real file** (tsx maps stacks to `.ts` via source maps), `getFileName()` is `.../src/apps/blog/index.ts`. Under the old bundle it would be the temp file — which is exactly why this only works post-refactor.

### 6.2 Default derivation

In pylon-db `register()` ([packages/pylon-db/src/app.ts](packages/pylon-db/src/app.ts)):

```ts
recordApp(name, {
  dependsOn: opts.dependsOn,
  dir: opts.migrations ?? (app.sourceDir && path.join(app.sourceDir, 'migrations')),
})
```

Explicit `migrations` always wins; otherwise `<app-dir>/migrations`. `appGroups()` already carries `group.dir`; the CLI already resolves + requires it. So this change is *only* about populating the default — the rest of the per-app-dir plumbing (already landed) is untouched.

### 6.3 Failure mode

If capture returns nothing (exotic construction, capture disabled), `dir` is undefined and the CLI throws its existing "declare `migrations`" error. Zero-config is a *default*, never a silent guess.

---

## 7. Consumer migration

| Consumer | Before | After |
| --- | --- | --- |
| `inspect` / `mcp` | `loadProjectApp().toIR()` in-process | `spawnProjectRunner('introspect')` → IR JSON |
| `build` | `loadAppContribution()` → IR | `spawnProjectRunner('introspect')` → IR JSON → `SchemaBuilder` |
| `verify` | load + build + check | same, introspection via child |
| `db <cmd>` | `loadProjectApp()` + `runDbCommand` in-process | `spawnProjectRunner('db', {command,…})`; `runDbCommand` runs **in the child** with the project ORM |

`runDbCommand` is refactored to take an **already-resolved `orm`** instead of calling `loadProjectApp` itself; the child provides it. The parent `db.*` handlers become thin spawners.

`loadProjectApp` (bundle), `prepareModelSource` (strip), and `importMetaPlugin` (shim) are **deleted**.

---

## 8. Rollout (incremental, each phase shippable)

- **Phase 0 — runner + introspect.** Add `project-runner` and `spawnProjectRunner`. Route `inspect` through it behind a flag. **Parity gate:** child IR byte-identical to bundle IR across fixtures.
- **Phase 1 — build/verify/mcp.** Switch the IR-data consumers. Delete `loadAppContribution`'s bundle path.
- **Phase 2 — db.** Move `runDbCommand` into the child. Gate on the full `db-migrate` + apps-deploy e2e.
- **Phase 3 — delete the bundle.** Remove `loadProjectApp`, `prepareModelSource`, `importMetaPlugin`.
- **Phase 4 — zero-config.** Add source-dir capture; default `<app-dir>/migrations`; make `db.migrations` optional; drop the explicit line from fixtures/docs.

Reversible: phases 0–2 keep the bundle available; only phase 3 commits.

---

## 9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| **Spawn overhead** (~100–300ms/tsx boot); dev/build call it often | Introspect once per build; keep a warm child for `pylon dev` (persistent runner, re-`import` on change); measure before/after |
| **Stack capture flaky** across tsx/source-maps | CallSite API not regex; unit tests per fixture; explicit `migrations` fallback; never guess silently |
| **`require.resolve` from project** edge cases (pnpm symlinks, ESM `exports`) | Test in the real e2e install layout; fall back to `import.meta.resolve` with project paths |
| **Entry serves on import** (legacy) | v3 entries don't; `PYLON_INTROSPECT` guard as defense |
| **Child error/exit propagation** | Structured fd-3 envelope + mirrored exit code; parent surfaces child stderr |
| **Watch mode** re-import staleness | Persistent dev runner invalidates module cache per change (today's unique-temp-name trick, but without a bundle) |

---

## 10. Alternatives considered

1. **Bundle + `import.meta` shim (shipped).** Makes the explicit line *work*; cannot *remove* it. Leaves the bundle machinery standing. Rejected as the end state — solves the wrong problem.
2. **Bundle + esbuild plugin injecting per-app source dirs.** Requires correlating runtime app name → source file during bundling; fragile. Rejected.
3. **Require apps to pass `import.meta`** (`new Pylon({meta: import.meta})`). Robust, no bundle change needed, but still per-app boilerplate — misses the goal. Viable fallback if stack capture proves unreliable.
4. **Child process + stack capture (this doc).** Zero-config, deletes the bundle, corrects `import.meta`/`__dirname`/stacks in user code. Biggest change; chosen because it's the only option that meets the primary goal.

---

## 11. Testing

- **Parity:** inspect/build IR identical pre/post refactor across all fixtures.
- **e2e:** `db-migrate` (single-app) + apps `deploy` (multi-app) through the child; the pre-existing `apps-build` server-spawn staleness is fixed or quarantined separately.
- **Unit:** `callerDir()` → source dir per fixture; zero-config default; explicit override precedence; capture-failure → CLI throw.
- **Safety net:** the migration round-trip / fuzz harness ([packages/pylon-db/test/integration/migration-roundtrip.test.ts](packages/pylon-db/test/integration/migration-roundtrip.test.ts)) is unaffected (tests the engine, not the loader) and guards against regressions.

---

## 12. Open questions

- **Warm child for `pylon dev`** — persistent process with cache invalidation, or accept per-reload spawn cost? (Affects dev-loop latency; see [[pylon_dev_loop_hmr]].)
- **queues** — same project-resolution treatment as pylon-db; confirm no second registry.
- **Monorepo/workspace** where pylon-dev and the project *do* share one pylon-db instance — the child still works (resolution just points at the same file); confirm no double-registration.
