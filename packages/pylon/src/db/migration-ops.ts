/**
 * Migration-authoring API (Django-style operations list).
 *
 * A migration is an ordered list of operations. Each operation knows how to
 * apply itself (`up`) and reverse itself (`down`):
 *
 *   - `schema(changes)` — declarative schema delta (generated from the IR diff).
 *     ALWAYS reversible: the IR renders both directions.
 *   - `runSql(sql, {down})` — raw SQL. Reversible ONLY if a `down` is given.
 *   - `run({up, down})` — a data migration (arbitrary code). The handler gets a
 *     `RunContext` with `db` and `models` — HISTORICAL models reconstructed from
 *     migration state (`{models}` → `models.get('Product').objects…`), so the
 *     migration never imports live classes and stays replay-safe when a model is
 *     later renamed/removed. Reversible ONLY if a `down` is given.
 *
 * Reversibility is per-operation; a migration is reversible iff every operation
 * is. Rolling back an irreversible operation throws rather than half-reverting.
 */
import {createHash} from 'node:crypto'
import {
  renderChanges,
  type ColumnSpec,
  type ForeignKeyChange,
  type IndexSpec,
  type SchemaChange,
  type TableColumn,
  type TableSpec
} from '../ir'
import type {Database} from './database.js'
import type {HistoricalModels} from './historical-models.js'

/** Execution context handed to each operation. */
export interface MigrationContext {
  /** Run a raw SQL statement (inside the migration transaction). */
  exec(sql: string): Promise<void>
  /** The connected database — for `run` data migrations using the ORM. */
  db: Database
  /** Models reconstructed from history at this point (for `run` handlers). */
  models: HistoricalModels
}

/** The context handed to a `run` data-migration handler. */
export interface RunContext {
  /** The connected database (escape hatch — `db.kysely` for raw queries). */
  db: Database
  /**
   * Models as they existed at this migration, reconstructed from history (not
   * imported from live code) — query via the usual `.objects` manager.
   */
  models: HistoricalModels
}

export interface Operation {
  readonly reversible: boolean
  /**
   * The schema delta this operation represents, if any. Schema operations carry
   * it so the runner can fold migration history into the state used to build
   * historical models; `runSql`/`run` leave it undefined (no schema effect).
   */
  readonly changes?: SchemaChange[]
  /**
   * A stable, content-derived string identifying what this op *does* (not how
   * the file is formatted). Hashed into the migration checksum so editing an
   * already-applied migration is detected. Schema ops use their serialized
   * changes; `runSql` uses its SQL; `run` uses its handler source (best-effort).
   */
  readonly fingerprint: string
  /** The SQL this op would run in the given direction (for `plan`; no DB). */
  preview(direction: 'up' | 'down'): string[]
  up(ctx: MigrationContext): Promise<void>
  down(ctx: MigrationContext): Promise<void>
}

export interface MigrationModule {
  operations: Operation[]
  /**
   * Names of the migration(s) this one builds on (the DAG edges). One parent for
   * a linear chain, two+ for a merge node, none for the root. Omitted → the
   * runner falls back to an implicit chain (the previous migration by name), so
   * histories that never recorded dependencies behave exactly as before.
   */
  dependencies?: string[]
}

/** Define a migration. The default export of a migration file. */
export function defineMigration(migration: MigrationModule): MigrationModule {
  return migration
}

/**
 * A declarative schema delta (from the IR diff). Always reversible.
 *
 * REFUSES a delta the renderer cannot fully express (a primary-key change on an
 * existing column; adding or removing generated-ness). Those render to NO SQL
 * while still folding into the reconstructed baseline — so the migration would
 * apply as a silent no-op and every gate afterwards (`status`, `check`, `deploy`)
 * would report "up to date" against a database that never received the change.
 * Express it explicitly instead: a `runSql` carrying the real DDL, paired with a
 * `stateOnly` recording the delta in the baseline.
 */
export function schema(changes: SchemaChange[]): Operation {
  const {up, down, unsupported} = renderChanges(changes)
  if (unsupported.length > 0) {
    throw new Error(
      `Schema operation cannot be expressed as SQL:\n` +
        unsupported.map(u => `  - ${u}`).join('\n') +
        `\nApplying it would be a no-op that still counts as captured, silently ` +
        `diverging the models from the database. Author it explicitly instead:\n` +
        `  migrations.runSql('<ddl>', {down: '<ddl>'}),\n` +
        `  migrations.stateOnly([/* the same change(s) */])`
    )
  }
  return {
    reversible: true,
    changes,
    fingerprint: `schema:${JSON.stringify(changes)}`,
    preview: direction => (direction === 'up' ? up : down),
    up: async ctx => {
      for (const stmt of up) await ctx.exec(stmt)
    },
    down: async ctx => {
      for (const stmt of down) await ctx.exec(stmt)
    }
  }
}

/**
 * Record a schema delta in the reconstructed baseline WITHOUT emitting any SQL —
 * the "state" half of Django's `SeparateDatabaseAndState`.
 *
 * This is the escape hatch for a change `schema()` refuses: run the real DDL with
 * an adjacent `runSql`, then `stateOnly` the delta so the folded baseline — and
 * therefore `status`/`check`/`deploy` — matches the database. You are ASSERTING
 * the database already looks this way; nothing verifies it, so only ever pair it
 * with the operation that makes it true.
 */
export function stateOnly(changes: SchemaChange[]): Operation {
  return {
    reversible: true,
    changes,
    fingerprint: `state:${JSON.stringify(changes)}`,
    preview: () => ['-- stateOnly(): baseline bookkeeping only, no SQL'],
    up: async () => {},
    down: async () => {}
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Named schema operations (Django-style). Each is a thin, readable constructor
// over a single SchemaChange — it inherits `schema()`'s built-in reverse, so no
// operation has to spell out its own `down`. The generator emits these; you can
// also hand-author them. For raw SQL or data logic, use runSql/run below.
// ───────────────────────────────────────────────────────────────────────────

/** Create a table from a table spec (columns only; FKs/indexes are separate ops). */
export function createTable(spec: TableSpec): Operation {
  return schema([{kind: 'createTable', spec}])
}

/** Drop a table. `down` re-creates it (columns only). */
export function dropTable(spec: TableSpec): Operation {
  return schema([{kind: 'dropTable', spec}])
}

/** Add a column. `down` drops it. Takes the migration column shape (`ColumnSpec`
 * + `property`), matching what the diff generator emits and `createTable` uses. */
export function addColumn(table: string, column: TableColumn): Operation {
  return schema([{kind: 'addColumn', table, column}])
}

/** Drop a column. `down` re-adds it from the given spec. */
export function dropColumn(table: string, column: TableColumn): Operation {
  return schema([{kind: 'dropColumn', table, column}])
}

/** Alter a column (type/nullable/default/unique). `down` restores `before`. */
export function alterColumn(table: string, before: TableColumn, after: TableColumn): Operation {
  return schema([{kind: 'alterColumn', table, before, after}])
}

/** Add a foreign-key constraint. `down` drops it. */
export function addForeignKey(fk: ForeignKeyChange): Operation {
  return schema([{kind: 'addForeignKey', fk}])
}

/** Drop a foreign-key constraint. `down` re-adds it from the given spec. */
export function dropForeignKey(fk: ForeignKeyChange): Operation {
  return schema([{kind: 'dropForeignKey', fk}])
}

/** Create an index. `down` drops it. */
export function addIndex(index: IndexSpec): Operation {
  return schema([{kind: 'addIndex', index}])
}

/** Drop an index. `down` re-creates it from the given spec. */
export function dropIndex(index: IndexSpec): Operation {
  return schema([{kind: 'dropIndex', index}])
}

/** Rename a column (data-preserving). `down` renames it back. */
export function renameColumn(table: string, from: string, to: string): Operation {
  return schema([{kind: 'renameColumn', table, from, to}])
}

/**
 * Rename a constraint (data-preserving) — e.g. a column-level UNIQUE/CHECK whose
 * name embeds a just-renamed column (Postgres keeps the old name). `down` renames
 * it back. Usually emitted automatically alongside a column rename.
 */
export function renameConstraint(table: string, from: string, to: string): Operation {
  return schema([{kind: 'renameConstraint', table, from, to}])
}

/**
 * Rename a table (data-preserving). Authoring-only — the diff can't infer a table
 * rename (it sees drop+create). `from`/`to` are the IR keys (model names, how the
 * snapshot is keyed — usually the class name); `fromTable`/`toTable` are the physical
 * table names the SQL renames. A class rename changes both, so both are given.
 * `down` renames back. Nested index/FK names still embed the old table — run
 * `pylon db diff` afterward to reconcile them (a safe drop/recreate).
 */
export function renameTable(opts: {
  from: string
  to: string
  fromTable: string
  toTable: string
}): Operation {
  return schema([{kind: 'renameTable', ...opts}])
}

/** Raw SQL. Reversible only when a `down` statement is supplied. */
export function runSql(up: string, opts: {down?: string} = {}): Operation {
  return {
    reversible: opts.down !== undefined,
    fingerprint: `sql:${up} ${opts.down ?? ''}`,
    preview: direction =>
      direction === 'up' ? [up] : opts.down ? [opts.down] : ['-- irreversible runSql (no down)'],
    up: ctx => ctx.exec(up),
    down: async ctx => {
      if (opts.down === undefined) {
        throw new Error('Irreversible operation: runSql has no `down`')
      }
      await ctx.exec(opts.down)
    }
  }
}

/** A data migration (arbitrary code). Reversible only when `down` is supplied. */
export function run(handlers: {
  up: (ctx: RunContext) => Promise<void>
  down?: (ctx: RunContext) => Promise<void>
}): Operation {
  return {
    reversible: handlers.down !== undefined,
    fingerprint: `run:${handlers.up.toString()} ${handlers.down?.toString() ?? ''}`,
    preview: () => ['-- run(): TypeScript data migration'],
    up: ctx => handlers.up({db: ctx.db, models: ctx.models}),
    down: async ctx => {
      if (!handlers.down) {
        throw new Error('Irreversible operation: run has no `down`')
      }
      await handlers.down({db: ctx.db, models: ctx.models})
    }
  }
}

/** A migration is reversible iff every operation is. */
export function isReversible(migration: MigrationModule): boolean {
  return migration.operations.every(op => op.reversible)
}

/**
 * A content-derived checksum of a migration (hash of its operations'
 * fingerprints). Stored in the ledger on apply and re-verified on every run, so
 * editing an already-applied migration is caught — the integrity guarantee that
 * makes the reconstructed baseline (and drift detection) trustworthy. Formatting
 * the file doesn't change it; changing what an op *does* does.
 */
export function migrationChecksum(migration: MigrationModule): string {
  const hash = createHash('sha256')
  for (const op of migration.operations) hash.update(`${op.fingerprint}`)
  return hash.digest('hex')
}
