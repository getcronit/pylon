/**
 * The ORM model-loading bridge, shared by `pylon db` and `pylon build`.
 *
 * The ORM's IR/registry only exists after the `@model()` decorators run, so any
 * consumer that needs it must EXECUTE the user's models — in the project's
 * module context, so the decorators populate the same `@getcronit/pylon-db`
 * instance we then read.
 *
 * Critically, we do NOT import the entry as-is: that would run its top-level
 * `serve(app)` / `Deno.serve(...)` and start a server during the build. Instead
 * we load a side-effect-stripped view of the entry (declarations + imports, no
 * serve, no default export) and re-export the project's pylon-orm. One native
 * ESM import yields a populated registry plus the API, from a single instance —
 * and no server starts. Runtime-agnostic, since every runtime's entrypoint form
 * is among the dropped statements.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {prepareModelSource} from './builder/prepare-model-source.js'
import {discoverRegistrationModules, importStatements} from './builder/discover.js'
import {pathToFileURL} from 'node:url'
import esbuild from 'esbuild'
import type {PhysicalSchema, PylonIR} from '@getcronit/pylon-ir'

/** The slice of `@getcronit/pylon-db` the dev tooling drives. Typed locally so
 *  pylon-dev needn't take a runtime dependency on the ORM. */
export interface ProjectOrm {
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

  /**
   * Queues registered during the load (re-exported from `@getcronit/pylon-queues`
   * IFF the project resolves it). Read from the loaded module's OWN instance so it
   * reflects what the project's `@queue()` decorators registered — a separate import
   * would be a different singleton under pnpm's isolated node_modules.
   */
  __pylonQueues?(): Array<{
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
    opts?: {now?: () => string}
  ): Promise<{name: string} | null>
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

export async function loadProjectOrm(
  cwd: string,
  modelsEntry: string
): Promise<ProjectOrm> {
  // Strip the entry's side effects (serve etc.) before loading, so executing it
  // registers models without starting a server. Imports inside the stripped
  // source resolve relative to the entry's own directory.
  const entryAbs = path.resolve(cwd, modelsEntry)
  const entrySource = await fs.readFile(entryAbs, 'utf8')
  const stripped = prepareModelSource(entrySource, path.basename(entryAbs))

  // Load EVERY model/queue module under the source root — not just the ones the
  // entry happens to import — so a decorated class can't be silently dropped from
  // the IR/migrations. Imported raw (they're pure registrations; only the entry has
  // serve side effects, which `stripped` removed). esbuild dedupes the overlap.
  const entryDir = path.dirname(entryAbs)
  const discovered = await discoverRegistrationModules(entryDir, entryAbs)
  const extraImports = importStatements(discovered, entryDir)

  // If the project uses pylon-queues, re-export its registry from THIS bundle so
  // `inspect` reads the same instance the queue decorators registered into (pnpm
  // isolates package instances, so a separate import would see an empty registry).
  // Detect by source (content) — robust regardless of the package's export conditions.
  const discoveredSources = await Promise.all(
    discovered.map(f => fs.readFile(f, 'utf8').catch(() => ''))
  )
  const usesQueues = [entrySource, ...discoveredSources].some(s =>
    s.includes('@getcronit/pylon-queues')
  )
  const queuesReexport = usesQueues
    ? `export {registeredQueues as __pylonQueues} from '@getcronit/pylon-queues'\n`
    : ''

  // Unique temp name per call so a watch-mode re-import re-runs the models
  // (a fixed name would be cached by the ESM loader → stale registry).
  const tmp = path.join(cwd, `.pylon-orm-entry.${process.pid}.${counter++}.mjs`)
  await esbuild.build({
    stdin: {
      contents: `${extraImports}${stripped}\nexport * from '@getcronit/pylon-db'\n${queuesReexport}`,
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
    return (await import(/* @vite-ignore */ pathToFileURL(tmp).href)) as unknown as ProjectOrm
  } finally {
    await fs.rm(tmp, {force: true})
  }
}

/**
 * Best-effort: the ORM's entity IR for a project, or `undefined` if the project
 * doesn't use the ORM (pylon-orm not resolvable, no models, or load failure).
 * Used by `pylon build` to feed `SchemaBuilder.build({contributeIR})`.
 */
export async function loadOrmContribution(
  cwd: string,
  modelsEntry: string
): Promise<PylonIR | undefined> {
  try {
    const orm = await loadProjectOrm(cwd, modelsEntry)
    if (typeof orm.toIR !== 'function') return undefined
    const ir = orm.toIR()
    return Object.keys(ir.entities).length > 0 ? ir : undefined
  } catch {
    return undefined
  }
}
