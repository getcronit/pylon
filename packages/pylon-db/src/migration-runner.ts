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
 * v1: operations execute on the connected pool, sequentially (not wrapped in a
 * single transaction). Atomic migrations are a future refinement.
 */
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {sql} from 'kysely'
import {
  applyChanges,
  diffSchema,
  physicalSchemaOf,
  renderChanges,
  type PhysicalSchema,
  type SchemaChange
} from '@getcronit/pylon-ir'
import {getDatabase, type Database} from './database.js'
import {buildHistoricalModels} from './historical-models.js'
import {isReversible, type MigrationContext, type MigrationModule} from './migration-ops.js'
import {snapshot, type Snapshot} from './migrations.js'

const APPLIED_TABLE = '_pylon_migrations'

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
      const applied = await this.appliedNames(db)
      unapplied = names.filter(n => !applied.has(n))
    }
    return {pendingChanges, migrations: names, unapplied}
  }

  private async ensureTable(db: Database): Promise<void> {
    await sql
      .raw(
        `CREATE TABLE IF NOT EXISTS "${APPLIED_TABLE}" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
      )
      .execute(db.kysely)
  }

  private async appliedNames(db: Database): Promise<Set<string>> {
    await this.ensureTable(db)
    const rows = await sql<{name: string}>`SELECT name FROM ${sql.ref(APPLIED_TABLE)}`.execute(
      db.kysely
    )
    return new Set(rows.rows.map(r => r.name))
  }

  /** A migration context bound to a reconstructed historical schema `state`. */
  private ctx(db: Database, state: PhysicalSchema): MigrationContext {
    return {
      db,
      exec: stmt => sql.raw(stmt).execute(db.kysely).then(() => undefined),
      models: buildHistoricalModels(state)
    }
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
   * The full history is replayed to thread a reconstructed schema `state`
   * (folding each op's `changes`), so a `run` op sees historical models for the
   * schema *as of that point* — even already-applied migrations are folded (not
   * re-executed) to keep the state accurate.
   */
  async apply(load: MigrationLoader, db: Database = getDatabase()): Promise<string[]> {
    const applied = await this.appliedNames(db)
    const history = await this.loadAll(load)
    const pending = history.filter(h => !applied.has(h.name)).map(h => h.name)

    let state: PhysicalSchema = {}
    for (const {name, mod} of history) {
      const isPending = !applied.has(name)
      for (const op of mod.operations) {
        if (isPending) await op.up(this.ctx(db, state)) // state BEFORE this op
        state = applyChanges(state, op.changes ?? [])
      }
      if (isPending) {
        await sql`INSERT INTO ${sql.ref(APPLIED_TABLE)} (name) VALUES (${name})`.execute(db.kysely)
      }
    }
    return pending
  }

  /** Reverse the most recently applied migration(s). Refuses irreversible ones. */
  async rollback(
    load: MigrationLoader,
    db: Database = getDatabase(),
    opts: {steps?: number} = {}
  ): Promise<string[]> {
    const applied = await this.appliedNames(db)
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

    for (const name of target) {
      const mod = history.find(h => h.name === name)!.mod
      if (!isReversible(mod)) {
        throw new Error(`Migration "${name}" is irreversible (an operation has no \`down\`).`)
      }
      const ctx = this.ctx(db, stateAfter.get(name) ?? {})
      for (const op of [...mod.operations].reverse()) await op.down(ctx)
      await sql`DELETE FROM ${sql.ref(APPLIED_TABLE)} WHERE name = ${name}`.execute(db.kysely)
    }
    return target
  }
}
