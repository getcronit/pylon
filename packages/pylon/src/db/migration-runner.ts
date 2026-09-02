/**
 * Migration workflow — file/DB orchestration over the operations model.
 *
 *   migrations/
 *     20260610T1200_init.ts         export default migrations.defineMigration({operations})
 *
 * The baseline is reconstructed by **folding the migration history's ops** into a
 * `PhysicalSchema` (Django-style `state_forwards`) — there is no `snapshot.json`;
 * the migrations are the single source of truth. `generate` diffs that
 * reconstructed schema against the current models and writes a timestamped TS
 * migration. `apply` runs unapplied migrations' operations in order; `rollback`
 * reverses the most-recently-applied ones (refusing irreversible migrations).
 * Migration files are TS, so they're loaded via an injected `MigrationLoader`
 * (the CLI transpiles them) — keeping this package transpiler-free.
 *
 * Each migration applies in its own transaction under a session advisory lock,
 * with a content checksum recorded in the `_pylon_migrations` ledger and
 * re-verified on every run (tamper detection).
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {sql, type Kysely} from 'kysely'
import {
  applyChanges,
  backfillWarnings,
  crossAppRetypeRefusals,
  diffSchema,
  physicalSchemaOf,
  renameCandidates,
  tableRenameCandidates,
  renderChanges,
  type Entity,
  type PhysicalSchema,
  type CastHint,
  type Rename,
  type TableRename,
  type SchemaChange
} from '../ir'
import {databaseForKysely, getDatabase, type Database} from './database.js'
import {buildHistoricalModels} from './historical-models.js'
import {
  isReversible,
  migrationChecksum,
  type MigrationContext,
  type MigrationDependency,
  type MigrationModule
} from './migration-ops.js'
import {snapshot, type Snapshot} from './migrations.js'

/**
 * The tables a set of schema changes CREATE vs. must find already present — derived
 * from the changes themselves (not the current models), so a since-removed FK still
 * orders correctly. Shared by the apply-time interleave and, at GENERATE time, by
 * the cross-app dependency emission: a `need` whose table another app owns becomes a
 * persisted `[app, migration]` edge.
 */
export function tablesOfChanges(
  changes: readonly SchemaChange[]
): {creates: Set<string>; needs: Set<string>} {
  const creates = new Set<string>()
  const needs = new Set<string>()
  for (const ch of changes as any[]) {
    switch (ch.kind) {
      case 'createTable':
        creates.add(ch.spec.table)
        break
      case 'renameTable':
        creates.add(ch.toTable)
        needs.add(ch.fromTable)
        break
      case 'dropTable':
        needs.add(ch.spec.table)
        break
      case 'addForeignKey':
      case 'dropForeignKey':
        needs.add(ch.fk.table)
        if (ch.fk.refTable) needs.add(ch.fk.refTable)
        break
      case 'addColumn':
      case 'dropColumn':
      case 'alterColumn':
      case 'renameColumn':
      case 'renameConstraint':
        if (ch.table) needs.add(ch.table)
        break
      case 'addIndex':
      case 'dropIndex':
        if (ch.index?.table) needs.add(ch.index.table)
        break
    }
  }
  for (const t of creates) needs.delete(t) // don't wait on what we make ourselves
  return {creates, needs}
}

const APPLIED_TABLE = '_pylon_migrations'
/** Fixed key for the migration advisory lock (pylon-specific constant). */
const ADVISORY_LOCK_KEY = 4_115_411_011

export interface GeneratedMigration {
  name: string
  changes: SchemaChange[]
  unsupported: string[]
  /** Valid SQL that will nonetheless fail on a table that already has rows. */
  warnings: string[]
  /** Drop+add pairs that look like renames — surfaced so the CLI can warn. */
  renameCandidates: Rename[]
  /** Drop+create table pairs (matching columns) that look like table renames. */
  tableRenameCandidates: TableRename[]
}

/** Loads a migration file into its module (the CLI provides a TS transpiler). */
export type MigrationLoader = (filePath: string) => Promise<MigrationModule>

export interface MigrationRunnerOptions {
  dir: string
  current?: () => Snapshot
  /**
   * FK-resolution universe (all apps' entities) — defaults to `current`'s
   * entities. Set it for a PER-APP runner whose `current` is scoped to one app:
   * a cross-app FK whose target table lives in another app then still resolves
   * (instead of being dropped). Lookup-only — does not add tables/migrations.
   */
  resolveAgainst?: () => Record<string, Entity>
  /**
   * Namespace this runner's ledger rows under `"<prefix>:"` so multiple apps —
   * sharing the one `_pylon_migrations` table — never collide on the migration
   * `name` PK, and each app sees only its own applied set. On-disk file names are
   * unchanged; only the ledger key is prefixed. Omitted = bare names (default).
   */
  ledgerPrefix?: string
  now?: () => string
}

function defaultStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
}

/** Indented JSON literal for embedding as a named-op argument. */
function arg(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/\n/g, '\n    ')
}

const str = (s: string): string => JSON.stringify(s)

/** Render one schema change as a readable, named `migrations.*` operation call. */
function opCall(change: SchemaChange): string {
  switch (change.kind) {
    case 'createTable':
      return `migrations.createTable(${arg(change.spec)})`
    case 'dropTable':
      return `migrations.dropTable(${arg(change.spec)})`
    case 'addColumn':
      return `migrations.addColumn(${str(change.table)}, ${arg(change.column)})`
    case 'dropColumn':
      return `migrations.dropColumn(${str(change.table)}, ${arg(change.column)})`
    case 'alterColumn': {
      // The conversion expressions must survive into the file — without them the
      // stored migration would re-render as a bare (and failing) TYPE change.
      const opts =
        change.using || change.usingDown
          ? `, ${arg({
              ...(change.using ? {using: change.using} : {}),
              ...(change.usingDown ? {usingDown: change.usingDown} : {})
            })}`
          : ''
      return `migrations.alterColumn(${str(change.table)}, ${arg(change.before)}, ${arg(change.after)}${opts})`
    }
    case 'addForeignKey':
      return `migrations.addForeignKey(${arg(change.fk)})`
    case 'dropForeignKey':
      return `migrations.dropForeignKey(${arg(change.fk)})`
    case 'addIndex':
      return `migrations.addIndex(${arg(change.index)})`
    case 'dropIndex':
      return `migrations.dropIndex(${arg(change.index)})`
    case 'renameColumn':
      return `migrations.renameColumn(${str(change.table)}, ${str(change.from)}, ${str(change.to)})`
    case 'renameConstraint':
      return `migrations.renameConstraint(${str(change.table)}, ${str(change.from)}, ${str(change.to)})`
    case 'renameTable':
      return `migrations.renameTable(${arg({from: change.from, to: change.to, fromTable: change.fromTable, toTable: change.toTable})})`
  }
}

function fileTemplate(
  changes: SchemaChange[],
  unsupported: string[],
  dependencies: MigrationDependency[] = [],
  cluster?: string
): string {
  const notes = unsupported.length
    ? unsupported.map(u => ` *   - ${u}`).join('\n')
    : ''
  const ops = changes.map(c => `    ${opCall(c)}`).join(',\n')
  const deps = dependencies.length ? `  dependencies: ${JSON.stringify(dependencies)},\n` : ''
  const cl = cluster ? `  cluster: ${JSON.stringify(cluster)},\n` : ''
  return (
    `import {migrations} from '@getcronit/pylon/db'\n\n` +
    (notes
      ? `/**\n * Manual attention needed (the diff couldn't express these):\n${notes}\n */\n`
      : '') +
    `export default migrations.defineMigration({\n` +
    cl +
    deps +
    `  // Generated schema delta. Add migrations.runSql(...) / migrations.run(...)\n` +
    `  // operations for data migrations (each with a \`down\` to stay reversible).\n` +
    `  operations: [\n` +
    `${ops}\n` +
    `  ]\n` +
    `})\n`
  )
}

export class MigrationRunner {
  private readonly dir: string
  private readonly current: () => Snapshot
  private readonly resolveAgainst?: () => Record<string, Entity>
  private readonly ledgerPrefix?: string
  /**
   * This runner's app identity — the label a bare (same-app) `dependencies` entry
   * normalizes under, and the app half of the tuples it authors. The group name for
   * a per-app runner; `'default'` for a non-apps project (single history, no groups),
   * which never carries a cross-app edge so the label is only ever internal.
   */
  private readonly app: string
  private readonly now: () => string

  constructor(options: MigrationRunnerOptions) {
    this.dir = options.dir
    this.current = options.current ?? snapshot
    this.resolveAgainst = options.resolveAgainst
    this.ledgerPrefix = options.ledgerPrefix
    this.app = options.ledgerPrefix ?? 'default'
    this.now = options.now ?? defaultStamp
  }

  /**
   * Same-app parent names of a migration, for the intra-app topo-sort. Normalizes
   * each authored dep to an `[app, migration]` tuple (bare string = this app), then
   * keeps only edges into THIS app — a cross-app tuple is not an intra-app parent
   * (the interleave consumes those). Dangling same-app edges are dropped here so a
   * partial history still loads; loud validation lives at the graph layer.
   */
  private sameAppParents(mod: MigrationModule, present: (name: string) => boolean): string[] {
    const out: string[] = []
    for (const dep of mod.dependencies ?? []) {
      const [app, name] = typeof dep === 'string' ? [this.app, dep] : dep
      if (app === this.app && present(name)) out.push(name)
    }
    return out
  }

  /** The ledger key for a bare migration name (app-namespaced when configured). */
  private ledgerName(name: string): string {
    return this.ledgerPrefix ? `${this.ledgerPrefix}:${name}` : name
  }

  /** Project the current (possibly app-scoped) entities, resolving cross-app FKs. */
  private currentPhysical(): PhysicalSchema {
    return physicalSchemaOf(this.current().entities, this.resolveAgainst?.())
  }

  /** Migration names on disk, chronological (timestamp-prefixed, sorted). */
  async list(): Promise<string[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.dir)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
    return entries
      .filter(f => f.endsWith('.ts'))
      .map(f => f.replace(/\.ts$/, ''))
      .sort()
  }

  private filePath(name: string): string {
    return path.join(this.dir, `${name}.ts`)
  }

  /**
   * Reconstruct the schema baseline by folding every migration's ops — the
   * single source of truth (no `snapshot.json`). `run`/`runSql` carry no schema
   * `changes`, so they're skipped (Django's `RunSQL`-has-no-`state_forwards`).
   */
  private async foldHistory(load: MigrationLoader): Promise<PhysicalSchema> {
    let schema: PhysicalSchema = {}
    for (const {mod} of await this.loadAll(load)) {
      for (const op of mod.operations) schema = applyChanges(schema, op.changes ?? [])
    }
    return schema
  }

  /**
   * Diff the reconstructed baseline against the current models; if anything
   * changed, write a timestamped TS migration. Returns it, or `null`.
   */
  async generate(
    name: string,
    load: MigrationLoader,
    opts: {
      renames?: Rename[]
      tableRenames?: TableRename[]
      castHints?: CastHint[]
      /**
       * Resolve a physical table this migration references to the `[app, migration]`
       * in ANOTHER app that creates it — the source of the persisted cross-app edges.
       * Provided by the multi-group orchestration (which sees every app's history);
       * absent for a single-app runner, which has no cross-app edges. Same-app needs
       * are ordered by the intra-app sequence, so this only ever names other apps.
       */
      crossAppCreator?: (table: string) => readonly [string, string] | undefined
    } = {}
  ): Promise<GeneratedMigration | null> {
    const prev = await this.foldHistory(load)
    const next = this.currentPhysical()
    const changes = diffSchema(prev, next, {
      renames: opts.renames,
      tableRenames: opts.tableRenames,
      castHints: opts.castHints
    })
    if (changes.length === 0) return null

    const {unsupported} = renderChanges(changes)
    // Cross-app FK-dependent type changes can't be coordinated in one migration (the
    // other end retypes in another app's separate transaction), so they'd fail
    // mid-deploy with a cryptic Postgres error. Detect them against the whole-project
    // FK set and refuse at generate time with an actionable message. Same-app FK
    // brackets are already emitted by `diffSchema`.
    const appTables = new Set(Object.keys(next).map(n => next[n].table))
    const universe = this.resolveAgainst ? physicalSchemaOf(this.resolveAgainst()) : next
    const universeFks = Object.values(universe).flatMap(t => t.foreignKeys ?? [])
    const refusals = [
      ...unsupported,
      ...crossAppRetypeRefusals(changes, appTables, universeFks)
    ]
    // Refuse rather than emit a migration whose unsupported half renders to no SQL:
    // it would apply cleanly, fold into the baseline as captured, and leave the
    // database silently behind the models with every gate reporting "up to date".
    if (refusals.length > 0) {
      throw new Error(
        `Cannot generate a migration — the diff contains change(s) the engine cannot ` +
          `express as SQL:\n` +
          refusals.map(u => `  - ${u}`).join('\n') +
          `\nFollow the hint above where one is given. Otherwise author this migration ` +
          `by hand: \`migrations.runSql('<ddl>', {down: '<ddl>'})\` for the DDL, plus ` +
          `\`migrations.stateOnly([...])\` so the baseline records it. (Reverting the ` +
          `model change lets \`db diff\` generate the rest.)`
      )
    }
    const migrationName = `${this.now()}_${name}`
    // Same-app parents (bare names) + persisted cross-app edges: for each table this
    // migration references that ANOTHER app creates, a `[app, migration]` tuple. This
    // is the edge the interleave used to derive at apply time; emitting it here is what
    // lets that derivation be retired.
    const dependencies: MigrationDependency[] = [...(await this.heads(load))]
    if (opts.crossAppCreator) {
      const {needs} = tablesOfChanges(changes)
      const seen = new Set<string>()
      for (const table of needs) {
        const creator = opts.crossAppCreator(table)
        if (!creator) continue
        const key = `${creator[0]} ${creator[1]}`
        if (seen.has(key)) continue
        seen.add(key)
        dependencies.push([creator[0], creator[1]])
      }
    }
    await fs.mkdir(this.dir, {recursive: true})
    await fs.writeFile(
      this.filePath(migrationName),
      fileTemplate(changes, unsupported, dependencies)
    )
    return {
      name: migrationName,
      changes,
      unsupported,
      warnings: backfillWarnings(changes),
      renameCandidates: renameCandidates(changes),
      tableRenameCandidates: tableRenameCandidates(changes)
    }
  }

  /**
   * Write a migration from EXPLICIT changes + dependency tuples — the primitive the
   * cross-app retype coordinator composes into pre/retype/post. Unlike `generate`, it
   * neither diffs nor computes deps; the caller supplies both. Refuses if the changes
   * can't render to SQL (same gate as `generate`). Returns the stamped name, or null
   * for an empty change set.
   */
  async emit(
    name: string,
    changes: SchemaChange[],
    dependencies: MigrationDependency[] = [],
    cluster?: string
  ): Promise<string | null> {
    if (changes.length === 0) return null
    const {unsupported} = renderChanges(changes)
    if (unsupported.length > 0) {
      throw new Error(
        `Cannot emit migration "${name}" — change(s) the engine cannot express as SQL:\n` +
          unsupported.map(u => `  - ${u}`).join('\n')
      )
    }
    const migrationName = `${this.now()}_${name}`
    await fs.mkdir(this.dir, {recursive: true})
    await fs.writeFile(
      this.filePath(migrationName),
      fileTemplate(changes, unsupported, dependencies, cluster)
    )
    return migrationName
  }

  /** This app's reconstructed schema (folded migration history) — the coordinator merges
   *  every app's to form the universe "before" for cross-app retype planning. */
  async foldedSchema(load: MigrationLoader): Promise<PhysicalSchema> {
    return this.foldHistory(load)
  }

  /**
   * Write an initial migration capturing an existing database's schema (as
   * produced by `introspectPhysical`). Unlike `generate`, this consults neither
   * models nor history — it emits `createTable`/FK/index ops for the *entire*
   * provided schema, so an established database can be adopted into the ledger.
   * Since those tables already exist, the caller marks the migration applied
   * (`resolve --applied`) rather than running it. Refuses to run when migrations
   * already exist (baseline is a once-only bootstrap).
   */
  async baseline(
    schema: PhysicalSchema,
    name = 'baseline'
  ): Promise<GeneratedMigration | null> {
    const existing = await this.list()
    if (existing.length > 0) {
      throw new Error(
        `Cannot baseline: ${existing.length} migration(s) already exist in "${this.dir}". ` +
          `Baseline is a one-time bootstrap for an un-migrated database.`
      )
    }
    const changes = diffSchema({}, schema)
    if (changes.length === 0) return null
    const {unsupported} = renderChanges(changes)
    const migrationName = `${this.now()}_${name}`
    await fs.mkdir(this.dir, {recursive: true})
    await fs.writeFile(
      this.filePath(migrationName),
      fileTemplate(changes, unsupported, [])
    )
    return {name: migrationName, changes, unsupported, warnings: [], renameCandidates: [], tableRenameCandidates: []}
  }

  /** Uncaptured changes (baseline vs current) + which migrations are unapplied. */
  async status(
    load: MigrationLoader,
    db?: Database
  ): Promise<{
    pendingChanges: SchemaChange[]
    migrations: string[]
    unapplied: string[]
  }> {
    const pendingChanges = diffSchema(await this.foldHistory(load), this.currentPhysical())
    const names = await this.list()
    let unapplied = names
    if (db) {
      const applied = await this.appliedMigrations(db)
      unapplied = names.filter(n => !applied.has(n))
    }
    return {pendingChanges, migrations: names, unapplied}
  }

  /**
   * The SQL each migration would run, in the given direction — no database
   * required (ops render their own SQL). For `down`, ops within a migration are
   * reversed. A read-only preview for review.
   */
  async plan(
    load: MigrationLoader,
    direction: 'up' | 'down' = 'up'
  ): Promise<Array<{name: string; statements: string[]}>> {
    const history = await this.loadAll(load)
    const ordered = direction === 'up' ? history : [...history].reverse()
    return ordered.map(({name, mod}) => {
      const ops = direction === 'up' ? mod.operations : [...mod.operations].reverse()
      return {name, statements: ops.flatMap(op => op.preview(direction))}
    })
  }

  private async ensureTable(db: Database): Promise<void> {
    await sql
      .raw(
        `CREATE TABLE IF NOT EXISTS "${APPLIED_TABLE}" ` +
          `(name text PRIMARY KEY, checksum text, applied_at timestamptz NOT NULL DEFAULT now())`
      )
      .execute(db.kysely)
    // Bring a pre-checksum ledger up to date.
    await sql
      .raw(`ALTER TABLE "${APPLIED_TABLE}" ADD COLUMN IF NOT EXISTS checksum text`)
      .execute(db.kysely)
  }

  /**
   * Applied migrations → their stored checksum (null for pre-checksum rows),
   * keyed by BARE name. When namespaced, only this runner's own rows are
   * returned (its `"<prefix>:"` rows, with the prefix stripped) — so an app's
   * applied set is isolated from other apps sharing the ledger.
   */
  private async appliedMigrations(db: Database): Promise<Map<string, string | null>> {
    await this.ensureTable(db)
    const rows = await sql<{name: string; checksum: string | null}>`SELECT name, checksum FROM ${sql.ref(
      APPLIED_TABLE
    )}`.execute(db.kysely)
    const prefix = this.ledgerPrefix ? `${this.ledgerPrefix}:` : undefined
    const out = new Map<string, string | null>()
    for (const r of rows.rows) {
      if (prefix) {
        if (r.name.startsWith(prefix)) out.set(r.name.slice(prefix.length), r.checksum)
      } else if (!r.name.includes(':')) {
        // Un-namespaced runner: ignore any app-namespaced rows that share the table.
        out.set(r.name, r.checksum)
      }
    }
    return out
  }

  /**
   * A migration context bound to a transaction `trx` and a reconstructed
   * historical schema `state`. `exec` runs on the trx; `db`/`models` resolve to
   * the trx (via the ambient binding set in `run*`), so every write a migration
   * makes — raw SQL, `run` data ops, historical-model writes — is in one
   * transaction and commits or rolls back atomically.
   */
  private trxCtx(trx: Kysely<any>, state: PhysicalSchema): MigrationContext {
    return {
      db: databaseForKysely(trx),
      exec: stmt => sql.raw(stmt).execute(trx).then(() => undefined),
      models: buildHistoricalModels(state)
    }
  }

  /**
   * Hold a session-level advisory lock for the duration of `fn`, so two
   * `migrate`/`rollback` processes can't run concurrently. The lock lives on a
   * single pinned connection; the migrations themselves run on their own
   * (transaction) connections while it's held.
   *
   * Postgres-specific (dialect override point): `pg_advisory_lock`. A non-PG
   * adapter would serialize migrations with its own mechanism (or a lock table).
   */
  private async withLock<T>(db: Database, fn: () => Promise<T>): Promise<T> {
    return db.kysely.connection().execute(async lockConn => {
      await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`.execute(lockConn)
      try {
        return await fn()
      } finally {
        await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`.execute(lockConn)
      }
    })
  }

  /**
   * Load every migration, ordered topologically by `dependencies` (the DAG).
   * A migration without explicit `dependencies` falls back to an implicit chain
   * (the previous migration by name), so dep-less histories keep their name
   * order. Branches (two migrations sharing a parent) order deterministically by
   * name; `down`/reverse callers reverse this list.
   *
   * Public so the group orchestration can read another app's history when emitting
   * cross-app dependency tuples (see `crossAppCreatorFor`).
   */
  async loadAll(
    load: MigrationLoader
  ): Promise<Array<{name: string; mod: MigrationModule}>> {
    const names = await this.list()
    const items = new Map<string, MigrationModule>()
    for (const name of names) items.set(name, await load(this.filePath(name)))

    const depsOf = (name: string): string[] => {
      const mod = items.get(name)
      const explicit = mod ? this.sameAppParents(mod, n => items.has(n)) : []
      if (explicit.length) return explicit
      const idx = names.indexOf(name)
      return idx > 0 ? [names[idx - 1]] : []
    }

    const out: Array<{name: string; mod: MigrationModule}> = []
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (name: string): void => {
      if (visited.has(name)) return
      if (visiting.has(name)) throw new Error(`Migration dependency cycle at "${name}".`)
      visiting.add(name)
      for (const dep of depsOf(name)) visit(dep)
      visiting.delete(name)
      visited.add(name)
      out.push({name, mod: items.get(name)!})
    }
    for (const name of names) visit(name) // names are sorted → deterministic
    return out
  }

  /** Leaf migrations — those nothing else depends on. >1 means divergent heads. */
  async heads(load: MigrationLoader): Promise<string[]> {
    const ordered = await this.loadAll(load)
    const names = ordered.map(o => o.name)
    const sorted = [...names].sort()
    const depended = new Set<string>()
    for (const {name, mod} of ordered) {
      const explicit = this.sameAppParents(mod, n => names.includes(n))
      if (explicit.length) explicit.forEach(d => depended.add(d))
      else {
        const idx = sorted.indexOf(name)
        if (idx > 0) depended.add(sorted[idx - 1])
      }
    }
    return names.filter(n => !depended.has(n))
  }

  /**
   * If the history has diverged into multiple heads (two branches added
   * migrations on the same parent), write a merge migration that depends on all
   * of them — re-converging the DAG. Returns null if there's ≤1 head.
   */
  async merge(load: MigrationLoader, name = 'merge'): Promise<{name: string; heads: string[]} | null> {
    const h = await this.heads(load)
    if (h.length <= 1) return null
    const mergeName = `${this.now()}_${name}`
    await fs.writeFile(this.filePath(mergeName), fileTemplate([], [], h))
    return {name: mergeName, heads: h}
  }

  /**
   * Apply every unapplied migration's operations in order; idempotent.
   *
   * Each migration runs in its OWN transaction (ops + ledger insert) — a failure
   * rolls the whole migration back, never a partial state. The full history is
   * folded to thread a reconstructed schema `state`, so a `run` op sees
   * historical models for the schema *as of that point*; already-applied
   * migrations are folded (not re-executed). An advisory lock serializes
   * concurrent runners.
   */
  async apply(load: MigrationLoader, db: Database = getDatabase()): Promise<string[]> {
    const history = await this.loadAll(load)

    // The applied-set is read INSIDE the lock. Reading it first and then locking
    // is a time-of-check/time-of-use race: two migrators both snapshot an empty
    // ledger, the first applies the history, and the second — still holding the
    // stale snapshot — replays it and dies on `relation "…" already exists`. That
    // is the ordinary case of two replicas (or CI and a human) deploying at once.
    return this.withLock(db, async () => {
      const applied = await this.appliedMigrations(db)

      // Integrity: an already-applied migration whose file no longer matches the
      // checksum it was applied with has been tampered with — refuse.
      for (const {name, mod} of history) {
        const stored = applied.get(name)
        if (applied.has(name) && stored && stored !== migrationChecksum(mod)) {
          throw new Error(
            `Migration "${name}" was modified after it was applied (checksum mismatch). ` +
              `Applied migrations are immutable — revert the edit, or use \`pylon db resolve\`.`
          )
        }
      }

      const pending = history.filter(h => !applied.has(h.name)).map(h => h.name)
      if (pending.length === 0) return []

      let state: PhysicalSchema = {}
      for (const {name, mod} of history) {
        if (!applied.has(name)) {
          const before = state
          await db.kysely.transaction().execute(async trx => {
            let s = before
            for (const op of mod.operations) {
              const ctx = this.trxCtx(trx, s)
              await ctx.db.run(() => op.up(ctx)) // ambient DB = trx
              s = applyChanges(s, op.changes ?? [])
            }
            await sql`INSERT INTO ${sql.ref(APPLIED_TABLE)} (name, checksum) VALUES (${this.ledgerName(
              name
            )}, ${migrationChecksum(mod)})`.execute(trx)
          })
        }
        for (const op of mod.operations) state = applyChanges(state, op.changes ?? [])
      }
      return pending
    })
  }

  /**
   * Apply MANY groups' migrations in one globally-correct order, not group-by-group.
   *
   * Neither naive order builds a fresh database:
   *  - Applying each group FULLY in dependency order runs a dependency's LATE migration
   *    (say, renaming a table) before a dependent's EARLY one that still references the
   *    old table — the classic "dependency's later work breaks the dependent's init".
   *  - Applying purely by TIMESTAMP runs a migration before the one that creates a table
   *    it references, because migration timestamps are assigned in registration order,
   *    which need not match FK dependency order (an app's init can be stamped earlier
   *    than the init of an app it FKs into).
   *
   * So we TOPOLOGICALLY sort the individual migrations under two kinds of edge, using the
   * timestamp only to break ties among migrations that are all ready:
   *  - intra-group: migration i waits for migration i-1 (their own sequence);
   *  - cross-app: a persisted `[app, migration]` tuple in a migration's `dependencies`
   *    waits for that migration in the named app. `generate` emits these for every table
   *    a migration references that another app creates — the edge that used to be derived
   *    from `changes` at apply time, now recorded once at generate time (so it survives an
   *    FK later removed from the models, and is inspectable in the file). A tuple naming a
   *    migration that doesn't exist fails loudly — there is no derivation to cover it.
   *
   * State is threaded across ALL migrations (applied ones included, so an unapplied data
   * migration's `ctx.models` sees the true historical schema), applying only the pending
   * ones — under one shared lock, each recorded in its own group's ledger prefix.
   */
  static async applyGroupsInterleaved(
    runners: Array<{runner: MigrationRunner; group: string}>,
    load: MigrationLoader,
    db: Database = getDatabase()
  ): Promise<Map<string, string[]>> {
    type Node = {
      gi: number
      idx: number
      name: string
      mod: MigrationModule
      pending: boolean
      indeg: number
      out: number[] // successor node ids
    }
    const byGroup = new Map<string, string[]>()
    runners.forEach(({group}) => byGroup.set(group, []))

    // Load every group's full history as node lists. Which of them are PENDING —
    // and the tamper check that depends on the same read — is deliberately NOT
    // decided here: the applied-set is read inside the lock below, so a concurrent
    // migrator can't leave us acting on a stale ledger snapshot (see `apply`).
    const perGroup: Node[][] = []
    const nodes: Node[] = []
    for (let gi = 0; gi < runners.length; gi++) {
      const {runner} = runners[gi]
      const history = await runner.loadAll(load)
      const list: Node[] = []
      history.forEach(({name, mod}, idx) => {
        const node: Node = {
          gi,
          idx,
          name,
          mod,
          pending: true, // decided under the lock
          indeg: 0,
          out: []
        }
        list.push(node)
        nodes.push(node)
      })
      perGroup.push(list)
    }
    if (nodes.length === 0) return byGroup

    const idOf = new Map(nodes.map((n, i) => [n, i]))
    const addEdge = (from: Node, to: Node) => {
      if (from === to) return
      from.out.push(idOf.get(to)!)
      to.indeg++
    }
    // Intra-group sequence.
    for (const list of perGroup) {
      for (let i = 1; i < list.length; i++) addEdge(list[i - 1], list[i])
    }
    // Persisted cross-app edges: a `[app, migration]` tuple in a node's dependencies
    // adds an edge from that migration in the named app. (Bare/same-app deps are the
    // intra-group sequence above.) This is the persisted counterpart of the derived
    // table edge; during the transition both run and agree. A tuple naming a migration
    // that doesn't exist fails loudly — there is no derivation to silently cover it.
    const nodeByKey = new Map<string, Node>()
    for (let gi = 0; gi < runners.length; gi++) {
      for (const n of perGroup[gi]) nodeByKey.set(`${runners[gi].group} ${n.name}`, n)
    }
    for (let gi = 0; gi < runners.length; gi++) {
      const selfGroup = runners[gi].group
      for (const n of perGroup[gi]) {
        for (const dep of n.mod.dependencies ?? []) {
          if (typeof dep === 'string' || dep[0] === selfGroup) continue // same-app → sequence
          const [app, name] = dep
          const target = nodeByKey.get(`${app} ${name}`)
          if (!target) {
            throw new Error(
              `Migration "${selfGroup}:${n.name}" depends on "${app}:${name}", which does ` +
                `not exist. A cross-app migration dependency must name a migration in ` +
                `another app's history — check the app name and the migration id.`
            )
          }
          addEdge(target, n)
        }
      }
    }

    // Kahn's algorithm, choosing among ready nodes by timestamp (name).
    const ready = nodes.filter(n => n.indeg === 0)
    const order: Node[] = []
    while (ready.length) {
      ready.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.gi - b.gi))
      const n = ready.shift()!
      order.push(n)
      for (const s of n.out) {
        const m = nodes[s]
        if (--m.indeg === 0) ready.push(m)
      }
    }
    if (order.length !== nodes.length) {
      throw new Error('Migration dependency cycle across groups.')
    }

    await runners[0].runner.withLock(db, async () => {
      // Applied-set read under the lock, per group — then the tamper check, so an
      // edited-after-apply migration is still refused before anything runs.
      for (let gi = 0; gi < runners.length; gi++) {
        const {runner, group} = runners[gi]
        const done = await runner.appliedMigrations(db)
        for (const n of perGroup[gi]) {
          const stored = done.get(n.name)
          if (done.has(n.name) && stored && stored !== migrationChecksum(n.mod)) {
            throw new Error(
              `Migration "${group}:${n.name}" was modified after it was applied (checksum ` +
                `mismatch). Applied migrations are immutable — revert the edit, or use ` +
                `\`pylon db resolve\`.`
            )
          }
          n.pending = !done.has(n.name)
        }
      }

      let state: PhysicalSchema = {}
      for (const n of order) {
        const {runner, group} = runners[n.gi]
        if (n.pending) {
          const before = state
          await db.kysely.transaction().execute(async trx => {
            let s = before
            for (const op of n.mod.operations) {
              const ctx = runner.trxCtx(trx, s)
              await ctx.db.run(() => op.up(ctx)) // ambient DB = trx
              s = applyChanges(s, op.changes ?? [])
            }
            await sql`INSERT INTO ${sql.ref(APPLIED_TABLE)} (name, checksum) VALUES (${runner.ledgerName(
              n.name
            )}, ${migrationChecksum(n.mod)})`.execute(trx)
          })
          byGroup.get(group)!.push(n.name)
        }
        // Accumulate state for EVERY migration (applied or not), so a later pending
        // migration's ctx.models reflects the full historical schema.
        for (const op of n.mod.operations) state = applyChanges(state, op.changes ?? [])
      }
    })
    return byGroup
  }

  /**
   * The one globally-correct order for a set of app runners' migrations — the shared
   * topo-sort behind interleaved apply and `rollbackGroupsInterleaved`. Two edge kinds:
   * intra-group sequence (migration i waits for i-1) and persisted cross-app
   * `[app, migration]` tuples; timestamp (name) breaks ties among ready nodes. A tuple
   * naming no such migration fails loudly; a cross-group cycle throws.
   */
  static async interleavedOrder(
    runners: Array<{runner: MigrationRunner; group: string}>,
    load: MigrationLoader
  ): Promise<Array<{group: string; name: string; mod: MigrationModule}>> {
    type Node = {gi: number; name: string; mod: MigrationModule; indeg: number; out: number[]}
    const perGroup: Node[][] = []
    const nodes: Node[] = []
    for (let gi = 0; gi < runners.length; gi++) {
      const history = await runners[gi].runner.loadAll(load)
      const list: Node[] = []
      for (const {name, mod} of history) {
        const node: Node = {gi, name, mod, indeg: 0, out: []}
        list.push(node)
        nodes.push(node)
      }
      perGroup.push(list)
    }
    if (nodes.length === 0) return []

    const idOf = new Map(nodes.map((n, i) => [n, i]))
    const addEdge = (from: Node, to: Node) => {
      if (from === to) return
      from.out.push(idOf.get(to)!)
      to.indeg++
    }
    for (const list of perGroup) {
      for (let i = 1; i < list.length; i++) addEdge(list[i - 1], list[i])
    }
    const nodeByKey = new Map<string, Node>()
    for (let gi = 0; gi < runners.length; gi++) {
      for (const n of perGroup[gi]) nodeByKey.set(`${runners[gi].group} ${n.name}`, n)
    }
    for (let gi = 0; gi < runners.length; gi++) {
      const selfGroup = runners[gi].group
      for (const n of perGroup[gi]) {
        for (const dep of n.mod.dependencies ?? []) {
          if (typeof dep === 'string' || dep[0] === selfGroup) continue
          const [app, name] = dep
          const target = nodeByKey.get(`${app} ${name}`)
          if (!target) {
            throw new Error(
              `Migration "${selfGroup}:${n.name}" depends on "${app}:${name}", which does ` +
                `not exist. A cross-app migration dependency must name a migration in ` +
                `another app's history — check the app name and the migration id.`
            )
          }
          addEdge(target, n)
        }
      }
    }

    const ready = nodes.filter(n => n.indeg === 0)
    const order: Node[] = []
    while (ready.length) {
      ready.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.gi - b.gi))
      const n = ready.shift()!
      order.push(n)
      for (const s of n.out) {
        const m = nodes[s]
        if (--m.indeg === 0) ready.push(m)
      }
    }
    if (order.length !== nodes.length) {
      throw new Error('Migration dependency cycle across groups.')
    }
    return order.map(n => ({group: runners[n.gi].group, name: n.name, mod: n.mod}))
  }

  /**
   * Reverse the most recently applied migrations ACROSS all apps, in reverse interleaved
   * order — the mirror of interleaved apply. Runs each migration's `down` newest first,
   * each in its own transaction, deleting its ledger row; refuses an irreversible one.
   *   - default: if the newest applied migration belongs to a cross-app CLUSTER (a
   *     coordinated retype's pre/retype/post share a `cluster` id), roll back the WHOLE
   *     cluster as a unit; otherwise just the newest.
   *   - `steps`: roll back the last N applied migrations regardless of clustering.
   */
  static async rollbackGroupsInterleaved(
    runners: Array<{runner: MigrationRunner; group: string}>,
    load: MigrationLoader,
    db: Database = getDatabase(),
    opts: {steps?: number} = {}
  ): Promise<Map<string, string[]>> {
    const byGroup = new Map<string, string[]>()
    runners.forEach(({group}) => byGroup.set(group, []))
    const order = await this.interleavedOrder(runners, load)
    if (order.length === 0) return byGroup
    const runnerOf = new Map(runners.map(r => [r.group, r.runner]))

    const done = new Map<string, Map<string, string | null>>()
    for (const {runner, group} of runners) done.set(group, await runner.appliedMigrations(db))
    const applied = order.filter(n => done.get(n.group)!.has(n.name))
    if (applied.length === 0) return byGroup

    let targets: typeof applied
    if (opts.steps != null) {
      targets = applied.slice(-opts.steps)
    } else {
      const newest = applied[applied.length - 1]
      const cid = newest.mod.cluster
      targets = cid ? applied.filter(n => n.mod.cluster === cid) : [newest]
    }

    // Validate the WHOLE set before touching the database — a coordinated cluster is
    // all-or-nothing, so an irreversible member (e.g. a retype whose `down` cast isn't
    // implicit) must refuse up front, not after earlier members have already committed.
    for (const n of [...targets].reverse()) {
      const stored = done.get(n.group)!.get(n.name)
      if (stored && stored !== migrationChecksum(n.mod)) {
        throw new Error(
          `Migration "${n.group}:${n.name}" was modified after it was applied (checksum ` +
            `mismatch). Revert the edit, or use \`pylon db resolve\`.`
        )
      }
      if (!isReversible(n.mod)) {
        throw new Error(
          `Cannot roll back: "${n.group}:${n.name}" is irreversible (its \`down\` can't be ` +
            `expressed — e.g. a non-implicit cast like text → uuid). Nothing was rolled back. ` +
            `Reverse it by hand, then \`pylon db resolve ${n.name} --rolled-back --app ${n.group}\`.`
        )
      }
    }

    // State AFTER each migration, threaded across the whole order, so a `down` handler's
    // `ctx.models` sees the schema that migration left behind. (applyChanges is pure.)
    const stateAfter = new Map<string, PhysicalSchema>()
    let state: PhysicalSchema = {}
    for (const n of order) {
      for (const op of n.mod.operations) state = applyChanges(state, op.changes ?? [])
      stateAfter.set(`${n.group} ${n.name}`, state)
    }

    await runners[0].runner.withLock(db, async () => {
      for (const n of [...targets].reverse()) {
        const runner = runnerOf.get(n.group)!
        await db.kysely.transaction().execute(async trx => {
          const ctx = runner.trxCtx(trx, stateAfter.get(`${n.group} ${n.name}`) ?? {})
          for (const op of [...n.mod.operations].reverse()) await ctx.db.run(() => op.down(ctx))
          await sql`DELETE FROM ${sql.ref(APPLIED_TABLE)} WHERE name = ${runner.ledgerName(
            n.name
          )}`.execute(trx)
        })
        byGroup.get(n.group)!.push(n.name)
      }
    })
    return byGroup
  }

  /**
   * Re-point this app's ledger rows after the APP was RENAMED. Migrations are keyed
   * `"<app>:<name>"`, so renaming an app orphans its already-applied rows under the
   * OLD prefix — `apply` then re-runs the (existing) init and fails with a raw
   * "relation already exists". Run this ONCE per database (before `migrate`) to move
   * `"<from>:*"` rows onto this runner's prefix. Idempotent; returns rows re-pointed.
   */
  async renameAppLedger(fromApp: string, db: Database = getDatabase()): Promise<number> {
    const to = this.ledgerPrefix
    if (!to) {
      throw new Error('renameAppLedger requires a per-app (ledger-namespaced) runner.')
    }
    if (fromApp === to) return 0
    await this.ensureTable(db)
    const from = `${fromApp}:`
    const res = await sql`UPDATE ${sql.ref(APPLIED_TABLE)} SET name = ${`${to}:`} || substr(name, ${
      from.length + 1
    }) WHERE name LIKE ${`${from}%`}`.execute(db.kysely)
    return Number(res.numAffectedRows ?? 0n)
  }

  /** Reverse the most recently applied migration(s). Refuses irreversible ones. */
  async rollback(
    load: MigrationLoader,
    db: Database = getDatabase(),
    opts: {steps?: number} = {}
  ): Promise<string[]> {
    const applied = await this.appliedMigrations(db)
    const history = await this.loadAll(load)

    // Reconstruct the state *after* each migration, so a `down` handler gets the
    // historical models for the schema that migration left behind.
    const stateAfter = new Map<string, PhysicalSchema>()
    let state: PhysicalSchema = {}
    for (const {name, mod} of history) {
      for (const op of mod.operations) state = applyChanges(state, op.changes ?? [])
      stateAfter.set(name, state)
    }

    // newest first (timestamp/sequence-prefixed names sort chronologically)
    const order = history.map(h => h.name).filter(n => applied.has(n)).reverse()
    const target = order.slice(0, opts.steps ?? 1)
    if (target.length === 0) return []

    await this.withLock(db, async () => {
      for (const name of target) {
        const mod = history.find(h => h.name === name)!.mod
        if (!isReversible(mod)) {
          throw new Error(`Migration "${name}" is irreversible (an operation has no \`down\`).`)
        }
        await db.kysely.transaction().execute(async trx => {
          const ctx = this.trxCtx(trx, stateAfter.get(name) ?? {})
          for (const op of [...mod.operations].reverse()) {
            await ctx.db.run(() => op.down(ctx))
          }
          await sql`DELETE FROM ${sql.ref(APPLIED_TABLE)} WHERE name = ${this.ledgerName(name)}`.execute(
            trx
          )
        })
      }
    })
    return target
  }

  /**
   * Mark a migration applied WITHOUT running it — for recovery when the schema
   * was changed out-of-band (e.g. a hotfix, or a migration applied manually).
   * Records the file's current checksum.
   */
  async markApplied(
    name: string,
    load: MigrationLoader,
    db: Database = getDatabase()
  ): Promise<void> {
    const mod = await load(this.filePath(name))
    await this.ensureTable(db)
    await sql`INSERT INTO ${sql.ref(APPLIED_TABLE)} (name, checksum) VALUES (${this.ledgerName(
      name
    )}, ${migrationChecksum(
      mod
    )}) ON CONFLICT (name) DO UPDATE SET checksum = excluded.checksum`.execute(db.kysely)
  }

  /** Mark a migration NOT applied WITHOUT reversing it (ledger-only). */
  async markRolledBack(name: string, db: Database = getDatabase()): Promise<void> {
    await this.ensureTable(db)
    await sql`DELETE FROM ${sql.ref(APPLIED_TABLE)} WHERE name = ${this.ledgerName(name)}`.execute(
      db.kysely
    )
  }

  /**
   * Collapse the whole schema history into a single migration. Refuses if any
   * migration carries a data op (`runSql`/`run` can't be folded into a schema
   * diff) or if the history is only partially applied. When a DB is given and
   * everything was applied, the ledger is reconciled (old rows → the squashed
   * one) so applied environments stay consistent; the original files are removed.
   * History rewrite — safe only before the migrations are shared/deployed.
   */
  async squash(
    load: MigrationLoader,
    name = 'squashed',
    db?: Database
  ): Promise<{name: string; replaced: string[]} | null> {
    const history = await this.loadAll(load)
    if (history.length === 0) return null

    for (const {name: n, mod} of history) {
      for (const op of mod.operations) {
        if (op.changes === undefined) {
          throw new Error(
            `Cannot squash: "${n}" contains a runSql/run operation that can't be folded ` +
              `into a schema diff. Squash schema-only history, or do it by hand.`
          )
        }
      }
    }

    const replaced = history.map(h => h.name)
    if (db) {
      const applied = await this.appliedMigrations(db)
      const appliedCount = replaced.filter(r => applied.has(r)).length
      if (appliedCount !== 0 && appliedCount !== replaced.length) {
        throw new Error(
          'Cannot squash: the history is partially applied. Apply or roll back fully first.'
        )
      }
    }

    let folded: PhysicalSchema = {}
    for (const {mod} of history) {
      for (const op of mod.operations) folded = applyChanges(folded, op.changes ?? [])
    }
    const changes = diffSchema({}, folded)
    const {unsupported} = renderChanges(changes)
    const squashName = `${this.now()}_${name}`

    await fs.writeFile(this.filePath(squashName), fileTemplate(changes, unsupported))
    for (const r of replaced) await fs.rm(this.filePath(r), {force: true})

    // If the originals were all applied, the DB already has this schema — record
    // the squashed migration as applied in their place.
    if (db) {
      const applied = await this.appliedMigrations(db)
      if (replaced.length > 0 && replaced.every(r => applied.has(r))) {
        const mod = await load(this.filePath(squashName))
        await db.kysely.transaction().execute(async trx => {
          for (const r of replaced) {
            await sql`DELETE FROM ${sql.ref(APPLIED_TABLE)} WHERE name = ${this.ledgerName(r)}`.execute(
              trx
            )
          }
          await sql`INSERT INTO ${sql.ref(APPLIED_TABLE)} (name, checksum) VALUES (${this.ledgerName(
            squashName
          )}, ${migrationChecksum(mod)})`.execute(trx)
        })
      }
    }
    return {name: squashName, replaced}
  }

  /** Applied migrations whose file no longer matches their stored checksum. */
  async integrityErrors(load: MigrationLoader, db: Database = getDatabase()): Promise<string[]> {
    const applied = await this.appliedMigrations(db)
    const out: string[] = []
    for (const {name, mod} of await this.loadAll(load)) {
      const stored = applied.get(name)
      if (applied.has(name) && stored && stored !== migrationChecksum(mod)) out.push(name)
    }
    return out
  }
}
