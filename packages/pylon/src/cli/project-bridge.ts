/**
 * The project-loading bridge, shared by `pylon db`, `pylon build`, `pylon inspect`,
 * `verify`, and `mcp`.
 *
 * A project's app — its models, queues, and the migration/IR API the CLI drives — only
 * exists after the registration code RUNS, so any consumer must EXECUTE the user's entry
 * in the project's own module context. `loadProjectApp` does that IN-PROCESS: it registers
 * tsx as a loader, imports the project's REAL modules, and resolves `@getcronit/pylon` /
 * `@getcronit/pylon/db` FROM THE PROJECT, so the models/queues register into the same
 * instances the CLI then reads — one instance, no bundle, and `import.meta`/stacks reflect
 * real files (which is what makes zero-config per-app migrations possible). v3 entries don't
 * serve on import (serving is a boot-time config plugin), so loading is side-effect-light.
 */
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import type {PhysicalSchema, PylonIR, Rename} from '../ir'
import type {SyncOptions} from '../db'

/** The project's pylon-db migration/IR API, as driven by `runDbCommandCore` in the
 *  child. Typed locally so pylon-dev needn't take a runtime dependency on the ORM. */
export interface ProjectApp {
  toIR(): PylonIR
  MigrationRunner: new (opts: {dir: string}) => {
    status(
      load: (filePath: string) => Promise<unknown>,
      db?: unknown
    ): Promise<{
      pendingChanges: unknown[]
      migrations: string[]
      unapplied: string[]
    }>
    generate(
      name: string,
      load: (filePath: string) => Promise<unknown>,
      opts?: {
        renames?: Array<{table: string; from: string; to: string}>
        tableRenames?: Array<{from: string; to: string}>
        castHints?: Array<{table: string; column: string; using?: string; usingDown?: string}>
      }
    ): Promise<{
      name: string
      changes: unknown[]
      warnings?: string[]
      renameCandidates: Array<{table: string; from: string; to: string}>
      tableRenameCandidates: Array<{from: string; to: string}>
    } | null>
    apply(load: (filePath: string) => Promise<unknown>, db?: unknown): Promise<string[]>
    rollback(
      load: (filePath: string) => Promise<unknown>,
      db?: unknown,
      opts?: {steps?: number}
    ): Promise<string[]>
    markApplied(
      name: string,
      load: (filePath: string) => Promise<unknown>,
      db?: unknown
    ): Promise<void>
    markRolledBack(name: string, db?: unknown): Promise<void>
    plan(
      load: (filePath: string) => Promise<unknown>,
      direction?: 'up' | 'down'
    ): Promise<Array<{name: string; statements: string[]}>>
    integrityErrors(load: (filePath: string) => Promise<unknown>, db?: unknown): Promise<string[]>
    squash(
      load: (filePath: string) => Promise<unknown>,
      name?: string,
      db?: unknown
    ): Promise<{name: string; replaced: string[]} | null>
    heads(load: (filePath: string) => Promise<unknown>): Promise<string[]>
    merge(
      load: (filePath: string) => Promise<unknown>,
      name?: string
    ): Promise<{name: string; heads: string[]} | null>
    /** Write an initial migration capturing an introspected schema (`baseline`). */
    baseline(
      schema: PhysicalSchema,
      name?: string
    ): Promise<{name: string; changes: unknown[]} | null>
  }
  connect(opts: {connectionString: string}): unknown
  /** Create the target database if it doesn't exist (dev convenience). */
  ensureDatabase(connectionString: string): Promise<{created: boolean; database: string}>
  /** Deep-introspect a live DB into a full PhysicalSchema (for `baseline`). */
  introspectPhysical(db?: unknown): Promise<PhysicalSchema>
  /** Generate editable model class stubs from an introspected schema. */
  generateModelSource(schema: PhysicalSchema): string
  /** Presence-level drift between the live DB and the current models. */
  schemaDrift(db?: unknown): Promise<{
    missingTables: string[]
    extraTables: string[]
    columns: Array<{table: string; missing: string[]; extra: string[]}>
    mismatches?: string[]
  }>
  hasDrift(d: {missingTables: string[]; extraTables: string[]; columns: unknown[]}): boolean
  /** Create tables for all models directly (no migration) — `db push`. `opts` carries the operator's
   *  confirmed destructive plan (renames / column drops); omitted = purely additive. */
  syncSchema(models?: unknown, opts?: SyncOptions): Promise<void>
  /** Read-only: the destructive drift a push would face — orphan columns + likely renames. */
  pushPlan(db?: unknown): Promise<{
    renameCandidates: Rename[]
    dropColumns: Array<{table: string; column: string}>
  }>
  /** Drop + recreate the schema (full clean slate) — `db reset`. */
  resetSchema(schema?: string): Promise<void>

  /** Every registered model (for `pylon inspect`'s authz/persistence harvest). */
  allModels?(): Array<{
    ctor: {name: string}
    tableName: string
    abstract: boolean
    app?: string
    tenantColumn?: string
    secure?: boolean
  }>

  /**
   * Every registered queue across ALL of the project's apps (the global pylon-queues
   * registry) — the queue analogue of `allModels()`. `pylon inspect` reads this so a
   * COMPOSED project, whose queues live on child apps and not the composed root entry,
   * still reports every queue. Absent if the project has no queues.
   */
  registeredQueues?(): Array<{
    name: string
    describe?(): {name: string; attempts?: number; concurrency?: number; hasSchema: boolean}
  }>

  // ── Apps / migration groups ─────────────────────────────────────────────────
  /** Migration groups DERIVED from the registry (empty when a project has no
   *  composed apps — the CLI then runs it as one implicit default app). */
  appGroups(): GroupLike[]
  // pylon-db migration-group orchestration (the CLI projects apps → groups).
  generateGroup(
    group: GroupLike,
    name: string,
    load: (filePath: string) => Promise<unknown>,
    opts?: {
      now?: () => string
      renames?: Array<{table: string; from: string; to: string}>
      tableRenames?: Array<{from: string; to: string}>
      castHints?: Array<{table: string; column: string; using?: string; usingDown?: string}>
      siblings?: GroupLike[]
      dryRun?: boolean
    }
  ): Promise<{
    name: string
    changes: unknown[]
      warnings?: string[]
    renameCandidates: Array<{table: string; from: string; to: string}>
    tableRenameCandidates: Array<{from: string; to: string}>
  } | null>
  migrateGroups(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>,
    db?: unknown
  ): Promise<Array<{group: string; applied: string[]}>>
  /** A correctly-configured migration runner for one group (bare ledger + all models
   *  for the root/default app; `<name>:`-prefixed ledger + scoped models otherwise). */
  groupRunner(
    group: GroupLike,
    opts?: {now?: () => string}
  ): InstanceType<ProjectApp['MigrationRunner']>
  /** Coordinate cross-app FK retypes: emit the pre/retype/post migrations across apps,
   *  wired by dependency tuples. Returns emitted `"app:migration"` names, or null when
   *  nothing is cross-app-joined. Throws on an unsatisfiable (one-sided) retype. */
  generateCoordinatedRetype(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>,
    name: string,
    opts?: {now?: () => string}
  ): Promise<string[] | null>
  /** Roll back the most recently applied migrations across all apps, reverse-interleaved.
   *  Default reverses the newest migration's whole cross-app cluster; `steps` reverses the
   *  last N. Returns the rolled-back names per app. */
  rollbackGroups(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>,
    db?: unknown,
    opts?: {steps?: number}
  ): Promise<Array<{group: string; applied: string[]}>>
  /** Squash one group's history + cascade-rewrite sibling cross-app dependency tuples. */
  squashGroups(
    groups: GroupLike[],
    groupName: string,
    load: (filePath: string) => Promise<unknown>,
    name?: string,
    db?: unknown
  ): Promise<{name: string; replaced: string[]} | null>
  /** Re-point the ledger + cross-app dependency tuples after an app rename. */
  renameGroupApp(
    groups: GroupLike[],
    fromApp: string,
    toApp: string,
    load: (filePath: string) => Promise<unknown>,
    db?: unknown
  ): Promise<number>
  statusGroups(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>,
    db?: unknown
  ): Promise<Array<{group: string; pendingChanges: number; pending?: string[]; unapplied: string[]}>>
  /** Groups in dependency order (siblings by name). */
  orderGroups(groups: GroupLike[]): GroupLike[]
  /** Tampered migrations across every group, labelled `"<app>:<migration>"`. */
  integrityErrorsGroups(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>,
    db?: unknown
  ): Promise<string[]>
  /** Migrations that reference a cross-app table but don't declare the edge — the
   *  hazard that breaks a from-scratch apply (`db reset`). Static; no DB. */
  detectMissingCrossAppDeps(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>
  ): Promise<
    Array<{
      app: string
      migration: string
      file: string
      needs: Array<{table: string; app: string; migration: string}>
    }>
  >
  /** Backfill the edges `detectMissingCrossAppDeps` finds into the migration files. */
  fixMissingCrossAppDeps(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>
  ): Promise<
    Array<{
      app: string
      migration: string
      file: string
      needs: Array<{table: string; app: string; migration: string}>
    }>
  >
}

/** A declared app == a pylon-db `MigrationGroup` (`export const apps` in the
 *  entry). graphql/routes are composed by hand elsewhere; the CLI reads only
 *  these migration-relevant fields. `dir` is an optional explicit migrations
 *  directory (default: <migrations root>/<name>). */
export interface GroupLike {
  name: string
  models?: Function[]
  dependencies?: string[]
  dir?: string
  /** The implicit default app: bare ledger, every model, root `./migrations`. */
  root?: boolean
}


// ── in-process project loader (subprocess-free) ─────────────────────────────────
let tsxRegistered = false
const appCache = new Map<string, Promise<ProjectApp>>()

/**
 * Load a Pylon project IN-PROCESS — the subprocess-free successor to spawning `project-runner`. It
 * registers tsx as a loader (the project's `.ts` transpiles on import), resolves the project's OWN
 * `@getcronit/pylon/db` from the entry (the one instance the models register into), and imports the
 * entry to populate the registry. The entry's own stdout during import is redirected to stderr so a
 * command's machine-readable stdout (e.g. `inspect` JSON) stays clean. Cached per resolved entry: a
 * second op in the same CLI invocation reuses the loaded, registered instance.
 *
 * Correctness equals the old child (one ORM instance via entry-scoped resolution, real files/stacks);
 * what the child additionally bought — hard `process.exit`/crash containment of the project entry — is
 * given up. Fine here: the CLI loads the user's OWN project, whose entry registers but doesn't serve.
 */
export async function loadProjectApp(cwd: string, modelsEntry: string): Promise<ProjectApp> {
  const entryAbs = path.resolve(cwd, modelsEntry)
  const cached = appCache.get(entryAbs)
  if (cached) return cached
  const loading = (async () => {
    if (!tsxRegistered) {
      const {register} = (await import('tsx/esm/api')) as {register: () => void}
      register()
      tsxRegistered = true
    }
    // Resolve the project's own pylon-db from the entry's location — NOT the CLI's copy — so the
    // migration runner drives the exact instance the models register into. `import.meta.resolve` (not
    // createRequire) so the ESM `import` condition applies: `./db` is an ESM-only export, invisible to
    // CJS `require` resolution. Under a bundler/vitest that strips `import.meta.resolve`, fall back to a
    // bare import — there the CLI and project share one (workspace) instance anyway.
    const entryUrl = pathToFileURL(entryAbs).href
    const resolver = (import.meta as {resolve?: (s: string, parent: string) => string}).resolve
    const ormSpecifier =
      typeof resolver === 'function' ? resolver('@getcronit/pylon/db', entryUrl) : '@getcronit/pylon/db'
    const orm = (await import(ormSpecifier)) as ProjectApp
    // The entry's import-time logs go to stderr (like the child forwarded them), keeping stdout clean.
    const realWrite = process.stdout.write.bind(process.stdout)
    ;(process.stdout as unknown as {write: typeof process.stderr.write}).write =
      process.stderr.write.bind(process.stderr)
    try {
      await import(entryUrl) // top-level runs → new Pylon(...) → models register into `orm`
    } finally {
      ;(process.stdout as unknown as {write: typeof process.stderr.write}).write = realWrite
    }
    return orm
  })()
  appCache.set(entryAbs, loading)
  return loading
}

/** Close the project ORM's default connection pool so the CLI can exit (best-effort; no-op if a
 *  command like `diff`/`plan` never connected). Does NOT drop the module from the cache — the
 *  registered models stay, so a later op reconnects against the same instance. */
export async function closeProjectApp(orm: ProjectApp): Promise<void> {
  try {
    const db = (orm as {getDatabase?: () => {destroy?: () => Promise<void>}}).getDatabase?.()
    await db?.destroy?.()
  } catch {
    /* never connected — nothing to close */
  }
}


/** The serializable ORM-derived data the AppModel is assembled from (parent-side). */
export interface IntrospectData {
  ir: PylonIR | null
  authz: Array<{model: string; table: string; app?: string; tenant?: string; secure: boolean}>
  queues: Array<{name: string; attempts?: number; concurrency?: number; hasSchema: boolean}>
}

/** Introspect a project IN-PROCESS → its IR + authz + queues (subprocess-free; see loadProjectApp).
 *  Models/IR come off the ORM; queues come off the app's own introspection surface (`app.introspect()`
 *  via `core.getApps()`) — each satellite reports its own slice through the extension bus, so the CLI
 *  reads ONE aggregated surface and never imports `@getcronit/pylon/queues` itself. */
export async function introspectAppData(cwd: string, modelsEntry: string): Promise<IntrospectData> {
  const orm = await loadProjectApp(cwd, modelsEntry) // imports the entry → apps are constructed
  try {
    const ir = orm.toIR()
    const authz = (orm.allModels?.() ?? [])
      .filter(m => !m.abstract)
      .map(m => ({
        model: m.ctor.name,
        table: m.tableName,
        app: m.app,
        tenant: m.tenantColumn,
        secure: Boolean(m.secure)
      }))
    // Read queues (and any other satellite's data) off the app itself, via core resolved from the
    // entry — the same instance the entry's `new Pylon(...)` registered into.
    const entryUrl = pathToFileURL(path.resolve(cwd, modelsEntry)).href
    const resolver = (import.meta as {resolve?: (s: string, parent: string) => string}).resolve
    const coreSpec =
      typeof resolver === 'function' ? resolver('@getcronit/pylon', entryUrl) : '@getcronit/pylon'
    const core = (await import(coreSpec)) as {getApps(): Array<{introspect(): Record<string, unknown>}>}
    const queues = core
      .getApps()
      .flatMap(a => (a.introspect().queues as IntrospectData['queues'] | undefined) ?? [])
    return {ir, authz, queues}
  } finally {
    await closeProjectApp(orm)
  }
}

/** Introspect a project in-process → its entity IR (or undefined). */
export async function introspectViaRunner(
  cwd: string,
  modelsEntry: string
): Promise<PylonIR | undefined> {
  const {ir} = await introspectAppData(cwd, modelsEntry)
  return ir && Object.keys(ir.entities).length > 0 ? ir : undefined
}

