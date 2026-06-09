/**
 * Migration workflow — file/DB orchestration over the operations model.
 *
 *   migrations/
 *     snapshot.json                 latest IR baseline (entities)
 *     20260610T1200_init.ts         export default migrations.defineMigration({operations})
 *
 * `generate` diffs the baseline snapshot against the current models and writes a
 * timestamped TS migration (a `schema(changes)` operation) + advances the
 * baseline. `apply` runs unapplied migrations' operations in order; `rollback`
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
import {diffEntities, renderChanges, type SchemaChange} from '@getcronit/pylon-ir'
import {getDatabase, type Database} from './database.js'
import {isReversible, type MigrationContext, type MigrationModule} from './migration-ops.js'
import {snapshot, type Snapshot} from './migrations.js'

const EMPTY: Snapshot = {version: 1, entities: {}}
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
      return `migrations.createTable(${arg(change.entity)})`
    case 'dropTable':
      return `migrations.dropTable(${arg(change.entity)})`
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

  private get snapshotPath(): string {
    return path.join(this.dir, 'snapshot.json')
  }

  async loadBaseline(): Promise<Snapshot> {
    try {
      return JSON.parse(await fs.readFile(this.snapshotPath, 'utf8')) as Snapshot
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY
      throw e
    }
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
   * Diff the baseline against the current models; if anything changed, write a
   * timestamped TS migration and advance the baseline. Returns it, or `null`.
   */
  async generate(name: string): Promise<GeneratedMigration | null> {
    const prev = await this.loadBaseline()
    const next = this.current()
    const changes = diffEntities(prev.entities, next.entities)
    if (changes.length === 0) return null

    const {unsupported} = renderChanges(changes)
    const migrationName = `${this.now()}_${name}`
    await fs.mkdir(this.dir, {recursive: true})
    await fs.writeFile(this.filePath(migrationName), fileTemplate(changes, unsupported))
    await fs.writeFile(this.snapshotPath, JSON.stringify(next, null, 2))
    return {name: migrationName, changes, unsupported}
  }

  /** Uncaptured changes (baseline vs current) + which migrations are unapplied. */
  async status(db?: Database): Promise<{
    pendingChanges: SchemaChange[]
    migrations: string[]
    unapplied: string[]
  }> {
    const prev = await this.loadBaseline()
    const pendingChanges = diffEntities(prev.entities, this.current().entities)
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

  private ctx(db: Database): MigrationContext {
    return {db, exec: stmt => sql.raw(stmt).execute(db.kysely).then(() => undefined)}
  }

  /** Apply every unapplied migration's operations in order; idempotent. */
  async apply(load: MigrationLoader, db: Database = getDatabase()): Promise<string[]> {
    const applied = await this.appliedNames(db)
    const pending = (await this.list()).filter(n => !applied.has(n))
    const ctx = this.ctx(db)

    for (const name of pending) {
      const mod = await load(this.filePath(name))
      for (const op of mod.operations) await op.up(ctx)
      await sql`INSERT INTO ${sql.ref(APPLIED_TABLE)} (name) VALUES (${name})`.execute(db.kysely)
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
    // newest first (timestamp-prefixed names sort chronologically)
    const order = (await this.list()).filter(n => applied.has(n)).reverse()
    const target = order.slice(0, opts.steps ?? 1)
    const ctx = this.ctx(db)

    for (const name of target) {
      const mod = await load(this.filePath(name))
      if (!isReversible(mod)) {
        throw new Error(`Migration "${name}" is irreversible (an operation has no \`down\`).`)
      }
      for (const op of [...mod.operations].reverse()) await op.down(ctx)
      await sql`DELETE FROM ${sql.ref(APPLIED_TABLE)} WHERE name = ${name}`.execute(db.kysely)
    }
    return target
  }
}
