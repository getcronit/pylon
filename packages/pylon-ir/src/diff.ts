/**
 * Migration projection: diff two IR snapshots → schema changes → SQL. A
 * migration is just the delta between two serialized `PylonIR.entities` maps.
 * You diff IRs, never databases or raw types — which is exactly why Phase 4
 * wants the IR: a stable, serializable thing to snapshot and compare.
 *
 * Pure functions, Postgres dialect. Covers tables (create/drop) and columns
 * (add/drop/alter type|nullable|default). Unique/index churn on existing
 * columns and FK-constraint diffing are intentionally out of v1 scope — they
 * are reported via `unsupported` so nothing is silently dropped.
 */
import {columnDDL, sqlTypeDDL, toDDL} from './ddl.js'
import type {ColumnSpec, Entity} from './ir.js'

export type SchemaChange =
  | {kind: 'createTable'; entity: Entity}
  | {kind: 'dropTable'; entity: Entity}
  | {kind: 'addColumn'; table: string; column: ColumnSpec}
  | {kind: 'dropColumn'; table: string; column: ColumnSpec}
  | {kind: 'alterColumn'; table: string; before: ColumnSpec; after: ColumnSpec}

export interface Migration {
  changes: SchemaChange[]
  up: string[]
  down: string[]
  /** Human-readable notes for deltas the v1 engine cannot express as SQL. */
  unsupported: string[]
}

function columnsOf(e: Entity): Map<string, ColumnSpec> {
  return new Map(
    e.fields.filter(f => f.column).map(f => [f.column!.name, f.column!])
  )
}

function columnEqual(a: ColumnSpec, b: ColumnSpec): boolean {
  return (
    a.sqlType === b.sqlType &&
    a.nullable === b.nullable &&
    a.unique === b.unique &&
    a.primaryKey === b.primaryKey &&
    a.length === b.length &&
    a.defaultSql === b.defaultSql &&
    a.default === b.default
  )
}

/** Compute the ordered set of changes from `prev` entities to `next` entities. */
export function diffEntities(
  prev: Record<string, Entity>,
  next: Record<string, Entity>
): SchemaChange[] {
  const changes: SchemaChange[] = []

  // New tables.
  for (const name of Object.keys(next)) {
    if (!(name in prev)) changes.push({kind: 'createTable', entity: next[name]})
  }

  // Column-level changes on tables present in both.
  for (const name of Object.keys(next)) {
    if (!(name in prev)) continue
    const before = columnsOf(prev[name])
    const after = columnsOf(next[name])
    const table = next[name].table

    for (const [col, spec] of after) {
      const prevSpec = before.get(col)
      if (!prevSpec) changes.push({kind: 'addColumn', table, column: spec})
      else if (!columnEqual(prevSpec, spec))
        changes.push({kind: 'alterColumn', table, before: prevSpec, after: spec})
    }
    for (const [col, spec] of before) {
      if (!after.has(col))
        changes.push({kind: 'dropColumn', table, column: spec})
    }
  }

  // Dropped tables.
  for (const name of Object.keys(prev)) {
    if (!(name in next)) changes.push({kind: 'dropTable', entity: prev[name]})
  }

  return changes
}

/** Postgres `ALTER COLUMN` statements bringing `before` to `after`. */
function alterColumnSQL(
  table: string,
  before: ColumnSpec,
  after: ColumnSpec,
  unsupported: string[]
): string[] {
  const out: string[] = []
  const col = `"${after.name}"`
  const t = `ALTER TABLE "${table}" ALTER COLUMN ${col}`
  if (before.sqlType !== after.sqlType || before.length !== after.length) {
    out.push(`${t} TYPE ${sqlTypeDDL(after)}`)
  }
  if (before.nullable !== after.nullable) {
    out.push(`${t} ${after.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`)
  }
  if (before.defaultSql !== after.defaultSql) {
    out.push(after.defaultSql ? `${t} SET DEFAULT ${after.defaultSql}` : `${t} DROP DEFAULT`)
  }
  if (before.unique !== after.unique) {
    unsupported.push(
      `unique change on ${table}.${after.name} (${before.unique} → ${after.unique}) — manage the constraint/index explicitly`
    )
  }
  return out
}

type Lookup = (name: string) => Entity | undefined

function up(change: SchemaChange, unsupported: string[], lookup: Lookup): string[] {
  switch (change.kind) {
    case 'createTable':
      return [toDDL(change.entity, lookup)]
    case 'dropTable':
      return [`DROP TABLE "${change.entity.table}"`]
    case 'addColumn':
      return [`ALTER TABLE "${change.table}" ADD COLUMN ${columnDDL(change.column)}`]
    case 'dropColumn':
      return [`ALTER TABLE "${change.table}" DROP COLUMN "${change.column.name}"`]
    case 'alterColumn':
      return alterColumnSQL(change.table, change.before, change.after, unsupported)
  }
}

function down(change: SchemaChange, unsupported: string[], lookup: Lookup): string[] {
  switch (change.kind) {
    case 'createTable':
      return [`DROP TABLE "${change.entity.table}"`]
    case 'dropTable':
      return [toDDL(change.entity, lookup)]
    case 'addColumn':
      return [`ALTER TABLE "${change.table}" DROP COLUMN "${change.column.name}"`]
    case 'dropColumn':
      return [`ALTER TABLE "${change.table}" ADD COLUMN ${columnDDL(change.column)}`]
    case 'alterColumn':
      return alterColumnSQL(change.table, change.after, change.before, unsupported)
  }
}

/** A lookup over the entities a change set creates/drops (for FK resolution). */
function lookupFromChanges(changes: SchemaChange[]): Lookup {
  const entities: Record<string, Entity> = {}
  for (const c of changes) {
    if (c.kind === 'createTable' || c.kind === 'dropTable') {
      entities[c.entity.name] = c.entity
    }
  }
  return name => entities[name]
}

/**
 * Render a set of changes to up + down SQL. Standalone (no prev/next maps), so a
 * migration's stored schema operation can render and reverse itself. FK targets
 * resolve against the entities created within the same change set.
 */
export function renderChanges(
  changes: SchemaChange[],
  lookup: Lookup = lookupFromChanges(changes)
): {up: string[]; down: string[]; unsupported: string[]} {
  const unsupported: string[] = []
  const upSQL = changes.flatMap(c => up(c, unsupported, lookup))
  // `down` reverses the change order so dependent ops unwind correctly.
  const downSQL = [...changes].reverse().flatMap(c => down(c, [], lookup))
  return {up: upSQL, down: downSQL, unsupported}
}

/** Build a full migration (changes + up/down SQL) between two entity maps. */
export function makeMigration(
  prev: Record<string, Entity>,
  next: Record<string, Entity>
): Migration {
  const changes = diffEntities(prev, next)
  const {up, down, unsupported} = renderChanges(
    changes,
    name => next[name] ?? prev[name]
  )
  return {changes, up, down, unsupported}
}
