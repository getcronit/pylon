/**
 * The project-loading bridge, shared by `pylon db`, `pylon build`, `pylon inspect`,
 * `verify`, and `mcp`.
 *
 * A project's app — its models, queues, and the migration/IR API the CLI drives — only
 * exists after the registration code RUNS, so any consumer must EXECUTE the user's entry
 * in the project's own module context. We do that in a CHILD process (`project-runner`,
 * run via tsx with `cwd` = the project): it imports the project's REAL modules and
 * resolves `@getcronit/pylon/db` FROM THE PROJECT, so the models register into the same
 * ORM instance we then read — one instance, no bundle, and `import.meta`/stack traces
 * reflect real files (which is what makes zero-config per-app migrations possible). v3
 * entries don't serve on import (serving is a boot-time config plugin), so no stripping.
 *
 * `spawnProjectRunner` is the parent-side spawn+envelope helper; introspection returns
 * serializable data, and `pylon db` runs its whole command in the child (see db/index).
 */
import {existsSync, promises as fsp} from 'node:fs'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {type RunnerEnvelope} from './project-runner-protocol.js'
import type {PhysicalSchema, PylonIR} from '../ir'

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
      }
    ): Promise<{
      name: string
      changes: unknown[]
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
  /** Deep-introspect a live DB into a full PhysicalSchema (for `baseline`). */
  introspectPhysical(db?: unknown): Promise<PhysicalSchema>
  /** Generate editable model class stubs from an introspected schema. */
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
  /** Re-point the ledger after an app rename (`fromApp` → `toApp`). */
  renameGroupApp(groups: GroupLike[], fromApp: string, toApp: string, db?: unknown): Promise<number>
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

const requireHere = createRequire(import.meta.url)

/** Absolute path to tsx's CLI (from pylon-dev's own deps), used to run the child. */
function tsxCliPath(): string {
  const pkgPath = requireHere.resolve('tsx/package.json')
  const pkg = requireHere(pkgPath) as {bin: string | {tsx: string}}
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.tsx
  return path.join(path.dirname(pkgPath), bin)
}

/** The runner file beside this module: `.js` in the built dist, `.ts` in dev/test. */
function projectRunnerPath(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const js = path.join(dir, 'project-runner.js')
  return existsSync(js) ? js : path.join(dir, 'project-runner.ts')
}

/**
 * Run the project runner as a tsx child (cwd = the project), so it loads the
 * project's REAL modules in the project's own context, and return its JSON
 * envelope. This is the bundle-free successor to `loadProjectApp` — one ORM
 * instance by project-scoped resolution, and `import.meta`/stacks reflect real
 * files. `op` selects the operation (`introspect`, later `db`, …).
 */
export async function spawnProjectRunner<T = unknown>(
  cwd: string,
  op: string,
  modelsEntry: string,
  extraArgs: string[] = []
): Promise<T> {
  // The result envelope goes to a temp FILE, NOT the streams — so the child's stdout
  // and stderr carry ONLY logs and can be forwarded to the terminal RAW (no filtering).
  // A file (unlike an extra fd) survives tsx re-spawning the runner.
  const resultFile = path.join(os.tmpdir(), `pylon-runner-${process.pid}-${runnerSeq++}.json`)
  const child = spawn(
    process.execPath,
    [tsxCliPath(), projectRunnerPath(), op, cwd, modelsEntry, ...extraArgs],
    {cwd, env: {...process.env, PYLON_RUNNER_RESULT_FILE: resultFile}, stdio: ['ignore', 'pipe', 'pipe']}
  )
  // Forward the child's output LIVE — to the parent's STDERR, so it can't corrupt the
  // parent's own stdout (e.g. `pylon inspect`'s JSON). Makes a `db seed`'s console.log
  // show as it runs, and a hang visible instead of silent.
  child.stdout?.on('data', (d: Buffer) => process.stderr.write(d))
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(d))

  const code: number = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', c => resolve(c ?? 0))
  })

  let raw: string
  try {
    raw = await fsp.readFile(resultFile, 'utf8')
  } catch {
    throw new Error(`project runner produced no result (exit ${code}); see output above.`)
  } finally {
    fsp.rm(resultFile, {force: true}).catch(() => {})
  }
  const envelope = JSON.parse(raw) as RunnerEnvelope<T>
  if (!envelope.ok) throw new Error(envelope.error ?? 'project runner failed')
  return envelope.result as T
}
let runnerSeq = 0

/** The serializable ORM-derived data the AppModel is assembled from (parent-side). */
export interface IntrospectData {
  ir: PylonIR | null
  authz: Array<{model: string; table: string; app?: string; tenant?: string; secure: boolean}>
  queues: Array<{name: string; attempts?: number; concurrency?: number; hasSchema: boolean}>
}

/** Introspect a project via the child runner → its IR + authz + queues. */
export function introspectAppData(cwd: string, modelsEntry: string): Promise<IntrospectData> {
  return spawnProjectRunner<IntrospectData>(cwd, 'introspect', modelsEntry)
}

/** Introspect a project via the child runner → its entity IR (or undefined). */
export async function introspectViaRunner(
  cwd: string,
  modelsEntry: string
): Promise<PylonIR | undefined> {
  const {ir} = await introspectAppData(cwd, modelsEntry)
  return ir && Object.keys(ir.entities).length > 0 ? ir : undefined
}

