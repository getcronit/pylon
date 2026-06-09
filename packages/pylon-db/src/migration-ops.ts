/**
 * Migration-authoring API (Django-style operations list).
 *
 * A migration is an ordered list of operations. Each operation knows how to
 * apply itself (`up`) and reverse itself (`down`):
 *
 *   - `schema(changes)` — declarative schema delta (generated from the IR diff).
 *     ALWAYS reversible: the IR renders both directions.
 *   - `runSql(sql, {down})` — raw SQL. Reversible ONLY if a `down` is given.
 *   - `run({up, down})` — a data migration (arbitrary code) against the connected
 *     `db`. May use the ORM (`Model.objects…`) since `migrate` connects the ORM's
 *     default database first. Reversible ONLY if a `down` is given. (Heads-up: a
 *     migration that imports live model classes breaks if that model is later
 *     renamed/removed — for long-lived data ops prefer raw `runSql`.)
 *
 * Reversibility is per-operation; a migration is reversible iff every operation
 * is. Rolling back an irreversible operation throws rather than half-reverting.
 */
import {
  renderChanges,
  type ColumnSpec,
  type Entity,
  type ForeignKeyChange,
  type IndexSpec,
  type SchemaChange
} from '@getcronit/pylon-ir'
import type {Database} from './database.js'

/** Execution context handed to each operation. */
export interface MigrationContext {
  /** Run a raw SQL statement (inside the migration transaction). */
  exec(sql: string): Promise<void>
  /** The connected database — for `run` data migrations using the ORM. */
  db: Database
}

export interface Operation {
  readonly reversible: boolean
  up(ctx: MigrationContext): Promise<void>
  down(ctx: MigrationContext): Promise<void>
}

export interface MigrationModule {
  operations: Operation[]
}

/** Define a migration. The default export of a migration file. */
export function defineMigration(migration: MigrationModule): MigrationModule {
  return migration
}

/** A declarative schema delta (from the IR diff). Always reversible. */
export function schema(changes: SchemaChange[]): Operation {
  const {up, down} = renderChanges(changes)
  return {
    reversible: true,
    up: async ctx => {
      for (const stmt of up) await ctx.exec(stmt)
    },
    down: async ctx => {
      for (const stmt of down) await ctx.exec(stmt)
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Named schema operations (Django-style). Each is a thin, readable constructor
// over a single SchemaChange — it inherits `schema()`'s built-in reverse, so no
// operation has to spell out its own `down`. The generator emits these; you can
// also hand-author them. For raw SQL or data logic, use runSql/run below.
// ───────────────────────────────────────────────────────────────────────────

/** Create a table from an entity spec (columns only; FKs/indexes are separate ops). */
export function createTable(entity: Entity): Operation {
  return schema([{kind: 'createTable', entity}])
}

/** Drop a table. `down` re-creates it (columns only). */
export function dropTable(entity: Entity): Operation {
  return schema([{kind: 'dropTable', entity}])
}

/** Add a column. `down` drops it. */
export function addColumn(table: string, column: ColumnSpec): Operation {
  return schema([{kind: 'addColumn', table, column}])
}

/** Drop a column. `down` re-adds it from the given spec. */
export function dropColumn(table: string, column: ColumnSpec): Operation {
  return schema([{kind: 'dropColumn', table, column}])
}

/** Alter a column (type/nullable/default/unique). `down` restores `before`. */
export function alterColumn(table: string, before: ColumnSpec, after: ColumnSpec): Operation {
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

/** Raw SQL. Reversible only when a `down` statement is supplied. */
export function runSql(up: string, opts: {down?: string} = {}): Operation {
  return {
    reversible: opts.down !== undefined,
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
  up: (db: Database) => Promise<void>
  down?: (db: Database) => Promise<void>
}): Operation {
  return {
    reversible: handlers.down !== undefined,
    up: ctx => handlers.up(ctx.db),
    down: async ctx => {
      if (!handlers.down) {
        throw new Error('Irreversible operation: run has no `down`')
      }
      await handlers.down(ctx.db)
    }
  }
}

/** A migration is reversible iff every operation is. */
export function isReversible(migration: MigrationModule): boolean {
  return migration.operations.every(op => op.reversible)
}
