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
  diffSchema,
  physicalSchemaOf,
  renameCandidates,
  renderChanges,
  type Entity,
  type PhysicalSchema,
  type Rename,
  type SchemaChange
} from '@getcronit/pylon-ir'
import {databaseForKysely, getDatabase, type Database} from './database.js'
import {buildHistoricalModels} from './historical-models.js'
import {
  isReversible,
  migrationChecksum,
  type MigrationContext,
  type MigrationModule
} from './migration-ops.js'
import {snapshot, type Snapshot} from './migrations.js'

const APPLIED_TABLE = '_pylon_migrations'
/** Fixed key for the migration advisory lock (pylon-specific constant). */
const ADVISORY_LOCK_KEY = 4_115_411_011

export interface GeneratedMigration {
  name: string
  changes: SchemaChange[]
  unsupported: string[]
  /** Drop+add pairs that look like renames — surfaced so the CLI can warn. */
  renameCandidates: Rename[]
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
    case 'alterColumn':
      return `migrations.alterColumn(${str(change.table)}, ${arg(change.before)}, ${arg(change.after)})`
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
  }
}

function fileTemplate(
  changes: SchemaChange[],
  unsupported: string[],
  dependencies: string[] = []
): string {
  const notes = unsupported.length
    ? unsupported.map(u => ` *   - ${u}`).join('\n')
    : ''
  const ops = changes.map(c => `    ${opCall(c)}`).join(',\n')
  const deps = dependencies.length ? `  dependencies: ${JSON.stringify(dependencies)},\n` : ''
  return (
    `import {migrations} from '@getcronit/pylon-db'\n\n` +
    (notes
      ? `/**\n * Manual attention needed (the diff couldn't express these):\n${notes}\n */\n`
      : '') +
    `export default migrations.defineMigration({\n` +
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
  private readonly now: () => string

  constructor(options: MigrationRunnerOptions) {
    this.dir = options.dir
    this.current = options.current ?? snapshot
    this.resolveAgainst = options.resolveAgainst
    this.ledgerPrefix = options.ledgerPrefix
    this.now = options.now ?? defaultStamp
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
    opts: {renames?: Rename[]} = {}
  ): Promise<GeneratedMigration | null> {
    const prev = await this.foldHistory(load)
    const next = this.currentPhysical()
    const changes = diffSchema(prev, next, {renames: opts.renames})
    if (changes.length === 0) return null

    const {unsupported} = renderChanges(changes)
    const migrationName = `${this.now()}_${name}`
    const dependencies = await this.heads(load) // the migration(s) this one builds on
    await fs.mkdir(this.dir, {recursive: true})
    await fs.writeFile(
      this.filePath(migrationName),
      fileTemplate(changes, unsupported, dependencies)
    )
    return {name: migrationName, changes, unsupported, renameCandidates: renameCandidates(changes)}
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
    return {name: migrationName, changes, unsupported, renameCandidates: []}
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
   */
  private async loadAll(
    load: MigrationLoader
  ): Promise<Array<{name: string; mod: MigrationModule}>> {
    const names = await this.list()
    const items = new Map<string, MigrationModule>()
    for (const name of names) items.set(name, await load(this.filePath(name)))

    const depsOf = (name: string): string[] => {
      const explicit = items.get(name)?.dependencies?.filter(d => items.has(d))
      if (explicit && explicit.length) return explicit
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
      const explicit = mod.dependencies?.filter(d => names.includes(d))
      if (explicit && explicit.length) explicit.forEach(d => depended.add(d))
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
    const applied = await this.appliedMigrations(db)
    const history = await this.loadAll(load)

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

    await this.withLock(db, async () => {
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
    })
    return pending
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
