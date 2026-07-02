/**
 * The project-loading bridge, shared by `pylon db`, `pylon build`, and `pylon inspect`.
 *
 * A project's app — its models, queues, and the migration/IR API the CLI drives — only
 * exists after the registration code RUNS, so any consumer must EXECUTE the user's entry,
 * in the project's own module context, so constructing `export default new Pylon({db:
 * {models}, queues})` (and every app it composes) registers into the SAME
 * `@getcronit/pylon-db` / `@getcronit/pylon-queues` instances we then read.
 *
 * Critically, we do NOT import the entry as-is: that would run its top-level
 * `serve(app)` / `Deno.serve(...)` and start a server. Instead we load a side-effect-
 * stripped view of the entry — `prepareModelSource` keeps declarations + imports, drops
 * `serve()`, and re-binds `export default <app>` to an exported `__pylonEntry` — and
 * re-export the project's pylon-db API (`export * from …`) plus, when present, the
 * project's `queuesOf`. One native ESM import yields the constructed app, its models
 * (`modelsOf(__pylonEntry)`) and queues (`queuesOf(__pylonEntry)`), and the API — from a
 * single instance, no server. Runtime-agnostic (every entrypoint form is dropped).
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {prepareModelSource} from './builder/prepare-model-source.js'
import {pathToFileURL} from 'node:url'
import esbuild from 'esbuild'
import type {PhysicalSchema, PylonIR} from '@getcronit/pylon-ir'

/** The loaded project's surface the dev tooling drives: the constructed app
 *  (`__pylonEntry` + `modelsOf`/`queuesOf`) plus the pylon-db migration/IR API. Typed
 *  locally so pylon-dev needn't take a runtime dependency on the ORM or queues. */
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
      opts?: {renames?: Array<{table: string; from: string; to: string}>}
    ): Promise<{
      name: string
      changes: unknown[]
      renameCandidates: Array<{table: string; from: string; to: string}>
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
  /** Deep-introspect a live DB into a full PhysicalSchema (for `baseline`). */
  introspectPhysical(db?: unknown): Promise<PhysicalSchema>
  /** Generate editable `@model()` class stubs from an introspected schema. */
  generateModelSource(schema: PhysicalSchema): string
  /** Presence-level drift between the live DB and the current models. */
  schemaDrift(db?: unknown): Promise<{
    missingTables: string[]
    extraTables: string[]
    columns: Array<{table: string; missing: string[]; extra: string[]}>
  }>
  hasDrift(d: {missingTables: string[]; extraTables: string[]; columns: unknown[]}): boolean
  /** Create tables for all models directly (no migration) — `db push`. */
  syncSchema(): Promise<void>

  /** Every registered model (for `pylon inspect`'s authz/persistence harvest). */
  allModels?(): Array<{
    ctor: {name: string}
    tableName: string
    abstract: boolean
    app?: string
    tenantColumn?: string
    secure?: boolean
  }>

  /** The project's default-exported app instance (`export default new Pylon(...)`),
   *  re-bound by `prepareModelSource` to a named export so the loader can read it. */
  __pylonEntry?: unknown
  /** The model classes the app owns (walks composed children). */
  modelsOf?(app: unknown): Array<new () => unknown>
  /**
   * The queue classes the app owns, read from the LOADED project's OWN pylon-queues
   * instance (re-exported by the bundle IFF the project uses queues) so it reflects what
   * the app's `queues: [...]` registered — a separate import would be a different
   * singleton under pnpm's isolated node_modules. Absent if the project has no queues.
   */
  queuesOf?(app: unknown): Array<{
    name: string
    describe?(): {name: string; attempts?: number; concurrency?: number; hasSchema: boolean}
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

  // ── Apps / migration groups (optional) ──────────────────────────────────────
  /** Migration groups DERIVED from the registry's `models.app(name)` tags. */
  appGroups?(): GroupLike[]
  // pylon-db migration-group orchestration (the CLI projects apps → groups).
  generateGroup(
    group: GroupLike,
    name: string,
    load: (filePath: string) => Promise<unknown>,
    opts?: {
      now?: () => string
      renames?: Array<{table: string; from: string; to: string}>
      tableRenames?: Array<{from: string; to: string}>
    }
  ): Promise<{
    name: string
    changes: unknown[]
    renameCandidates: Array<{table: string; from: string; to: string}>
    tableRenameCandidates: Array<{from: string; to: string}>
  } | null>
  migrateGroups(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>,
    db?: unknown
  ): Promise<Array<{group: string; applied: string[]}>>
  deployGroups(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>,
    db?: unknown
  ): Promise<Array<{group: string; applied: string[]}>>
  statusGroups(
    groups: GroupLike[],
    load: (filePath: string) => Promise<unknown>,
    db?: unknown
  ): Promise<Array<{group: string; pendingChanges: number; unapplied: string[]}>>
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
}

let counter = 0

export async function loadProjectApp(
  cwd: string,
  modelsEntry: string
): Promise<ProjectApp> {
  // Strip the entry's side effects (serve etc.) before loading, so executing it
  // registers models without starting a server. Imports inside the stripped
  // source resolve relative to the entry's own directory.
  const entryAbs = path.resolve(cwd, modelsEntry)
  const entrySource = await fs.readFile(entryAbs, 'utf8')
  const stripped = prepareModelSource(entrySource, path.basename(entryAbs))

  // Constructor-only registration: importing the (stripped) entry constructs
  // `export default new Pylon({db: {models}, queues})` — and every app it composes —
  // which registers all models/queues into the registry. The entry's import graph
  // reaches every registered class, so there's no whole-tree discovery to do.
  //
  // If the project uses pylon-queues, re-export its registry from THIS bundle so
  // `inspect` reads the same instance the constructor registered into (pnpm isolates
  // package instances, so a separate import would see an empty registry). Detect by the
  // entry importing it (the common case), with a manifest fallback for an entry that
  // imports it only transitively (a composed app does, the root entry doesn't). Guard
  // either way — re-exporting an absent package would fail the whole IR load. Read the
  // project's `package.json` rather than `require.resolve` — the package is ESM-only and
  // its `exports` map blocks both a bare and a `package.json`-subpath CJS resolve, so a
  // resolve probe is a false negative.
  let usesQueues = entrySource.includes('@getcronit/pylon-queues')
  if (!usesQueues) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'))
      const deps = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies
      }
      usesQueues = Boolean(deps['@getcronit/pylon-queues'])
    } catch {
      /* no manifest / not a dependency */
    }
  }
  const queuesReexport = usesQueues
    ? `export {queuesOf, registeredQueues} from '@getcronit/pylon-queues'\n`
    : ''

  // Unique temp name per call so a watch-mode re-import re-runs the models
  // (a fixed name would be cached by the ESM loader → stale registry).
  const tmp = path.join(cwd, `.pylon-orm-entry.${process.pid}.${counter++}.mjs`)
  await esbuild.build({
    stdin: {
      contents: `${stripped}\nexport * from '@getcronit/pylon-db'\n${queuesReexport}`,
      resolveDir: path.dirname(entryAbs),
      loader: 'ts',
      sourcefile: 'pylon-orm-entry.ts'
    },
    outfile: tmp,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false
      }
    }
  })

  try {
    return (await import(/* @vite-ignore */ pathToFileURL(tmp).href)) as unknown as ProjectApp
  } finally {
    await fs.rm(tmp, {force: true})
  }
}

/**
 * Best-effort: the ORM's entity IR for a project, or `undefined` if the project
 * doesn't use the ORM (pylon-orm not resolvable, no models, or load failure).
 * Used by `pylon build` to feed `SchemaBuilder.build({contributeIR})`.
 */
export async function loadAppContribution(
  cwd: string,
  modelsEntry: string
): Promise<PylonIR | undefined> {
  try {
    const orm = await loadProjectApp(cwd, modelsEntry)
    if (typeof orm.toIR !== 'function') return undefined
    const ir = orm.toIR()
    return Object.keys(ir.entities).length > 0 ? ir : undefined
  } catch {
    return undefined
  }
}
