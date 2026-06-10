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
  renderChanges,
  type PhysicalSchema,
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
}

/** Loads a migration file into its module (the CLI provides a TS transpiler). */
export type MigrationLoader = (filePath: string) => Promise<MigrationModule>

export interface MigrationRunnerOptions {
  dir: string
  current?: () => Snapshot
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

function fileTemplate(changes: SchemaChange[], unsupported: string[]): string {
  const notes = unsupported.length
    ? unsupported.map(u => ` *   - ${u}`).join('\n')
    : ''
  const ops = changes.map(c => `    ${opCall(c)}`).join(',\n')
  return (
    `import {migrations} from '@getcronit/pylon-db'\n\n` +
    (notes
      ? `/**\n * Manual attention needed (the diff couldn't express these):\n${notes}\n */\n`
      : '') +
    `export default migrations.defineMigration({\n` +
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
  private readonly now: () => string

  constructor(options: MigrationRunnerOptions) {
    this.dir = options.dir
    this.current = options.current ?? snapshot
    this.now = options.now ?? defaultStamp
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
  async generate(name: string, load: MigrationLoader): Promise<GeneratedMigration | null> {
    const prev = await this.foldHistory(load)
    const next = physicalSchemaOf(this.current().entities)
    const changes = diffSchema(prev, next)
    if (changes.length === 0) return null

    const {unsupported} = renderChanges(changes)
    const migrationName = `${this.now()}_${name}`
    await fs.mkdir(this.dir, {recursive: true})
    await fs.writeFile(this.filePath(migrationName), fileTemplate(changes, unsupported))
    return {name: migrationName, changes, unsupported}
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
    const pendingChanges = diffSchema(
      await this.foldHistory(load),
      physicalSchemaOf(this.current().entities)
    )
    const names = await this.list()
    let unapplied = names
    if (db) {
      const applied = await this.appliedMigrations(db)
      unapplied = names.filter(n => !applied.has(n))
    }
    return {pendingChanges, migrations: names, unapplied}
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

  /** Applied migrations → their stored checksum (null for pre-checksum rows). */
  private async appliedMigrations(db: Database): Promise<Map<string, string | null>> {
    await this.ensureTable(db)
    const rows = await sql<{name: string; checksum: string | null}>`SELECT name, checksum FROM ${sql.ref(
      APPLIED_TABLE
    )}`.execute(db.kysely)
    return new Map(rows.rows.map(r => [r.name, r.checksum]))
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

  /** Load every migration on disk, in chronological order. */
  private async loadAll(
    load: MigrationLoader
  ): Promise<Array<{name: string; mod: MigrationModule}>> {
    const out: Array<{name: string; mod: MigrationModule}> = []
    for (const name of await this.list()) {
      out.push({name, mod: await load(this.filePath(name))})
    }
    return out
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
            await sql`INSERT INTO ${sql.ref(APPLIED_TABLE)} (name, checksum) VALUES (${name}, ${migrationChecksum(
              mod
            )})`.execute(trx)
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
          await sql`DELETE FROM ${sql.ref(APPLIED_TABLE)} WHERE name = ${name}`.execute(trx)
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
    await sql`INSERT INTO ${sql.ref(APPLIED_TABLE)} (name, checksum) VALUES (${name}, ${migrationChecksum(
      mod
    )}) ON CONFLICT (name) DO UPDATE SET checksum = excluded.checksum`.execute(db.kysely)
  }

  /** Mark a migration NOT applied WITHOUT reversing it (ledger-only). */
  async markRolledBack(name: string, db: Database = getDatabase()): Promise<void> {
    await this.ensureTable(db)
    await sql`DELETE FROM ${sql.ref(APPLIED_TABLE)} WHERE name = ${name}`.execute(db.kysely)
  }
}
