/**
 * Migration-authoring API (Django-style operations list).
 *
 * A migration is an ordered list of operations. Each operation knows how to
 * apply itself (`up`) and reverse itself (`down`):
 *
 *   - `schema(changes)` — declarative schema delta (generated from the IR diff).
 *     ALWAYS reversible: the IR renders both directions.
 *   - `runSql(sql, {down})` — raw SQL. Reversible ONLY if a `down` is given.
 *   - `run({up, down})` — arbitrary code (data migration), may use the ORM.
 *     Reversible ONLY if a `down` is given.
 *
 * Reversibility is per-operation; a migration is reversible iff every operation
 * is. Rolling back an irreversible operation throws rather than half-reverting.
 */
import {renderChanges, type SchemaChange} from '@getcronit/pylon-ir'
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
