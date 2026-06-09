/**
 * Migration projection: diff two IR snapshots → schema changes → SQL. A
 * migration is just the delta between two serialized `PylonIR.entities` maps.
 * You diff IRs, never databases or raw types — which is exactly why the IR
 * exists: a stable, serializable thing to snapshot and compare.
 *
 * Pure functions, Postgres dialect. Covers tables (create/drop), columns
 * (add/drop/alter type|nullable|default|unique) and foreign keys
 * (add/drop/retarget/onDelete). Foreign keys are *not* rendered inline in
 * `CREATE TABLE`: they are resolved here, at diff time, into self-contained
 * `addForeignKey`/`dropForeignKey` changes that carry the concrete ref table +
 * column. That makes a stored migration replayable without the rest of the
 * schema — a new table can reference an existing one, which inline FKs (which
 * could only see the change-set) silently dropped.
 *
 * Out of scope (reported via `unsupported`, never silently dropped): primary-key
 * changes on an existing column, and secondary indexes (not yet modeled in the
 * IR). Dropping a relation *and* its FK column relies on Postgres' `DROP COLUMN`
 * cascade, so the constraint is not separately re-created on rollback.
 */
import {columnDDL, sqlTypeDDL, toDDL} from './ddl.js'
import type {ColumnSpec, Entity, OnDelete} from './ir.js'

/** A resolved foreign-key constraint — self-contained, no schema lookup needed. */
export interface ForeignKeyChange {
  /** Table the constraint lives on. */
  table: string
  /** Deterministic constraint name (`<table>_<column>_fkey`, Postgres style). */
  name: string
  /** Local FK column. */
  column: string
  /** Referenced table. */
  refTable: string
  /** Referenced column (the target's primary key). */
  refColumn: string
  onDelete?: OnDelete
}

export type SchemaChange =
  | {kind: 'createTable'; entity: Entity}
  | {kind: 'dropTable'; entity: Entity}
  | {kind: 'addColumn'; table: string; column: ColumnSpec}
  | {kind: 'dropColumn'; table: string; column: ColumnSpec}
  | {kind: 'alterColumn'; table: string; before: ColumnSpec; after: ColumnSpec}
  | {kind: 'addForeignKey'; fk: ForeignKeyChange}
  | {kind: 'dropForeignKey'; fk: ForeignKeyChange}

export interface Migration {
  changes: SchemaChange[]
  up: string[]
  down: string[]
  /** Human-readable notes for deltas the engine cannot express as SQL. */
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

/**
 * Resolve an entity's `belongsTo` relations into concrete FK constraints, keyed
 * by constraint name. Skips a relation whose FK column or target PK can't be
 * resolved within the given entity map (e.g. a dangling target).
 */
function foreignKeysOf(
  e: Entity,
  entities: Record<string, Entity>
): Map<string, ForeignKeyChange> {
  const out = new Map<string, ForeignKeyChange>()
  for (const f of e.fields) {
    const rel = f.relation
    if (!rel || rel.kind !== 'belongsTo' || !rel.fkField) continue
    const column = e.fields.find(c => c.name === rel.fkField)?.column?.name
    const target = entities[rel.target]
    const refColumn = target?.fields.find(c => c.name === target.primaryKey)?.column?.name
    if (!column || !target || !refColumn) continue
    const name = `${e.table}_${column}_fkey`
    out.set(name, {
      table: e.table,
      name,
      column,
      refTable: target.table,
      refColumn,
      onDelete: rel.onDelete
    })
  }
  return out
}

function fkEqual(a: ForeignKeyChange, b: ForeignKeyChange): boolean {
  return a.refTable === b.refTable && a.refColumn === b.refColumn && a.onDelete === b.onDelete
}

/** Compute the ordered set of changes from `prev` entities to `next` entities. */
export function diffEntities(
  prev: Record<string, Entity>,
  next: Record<string, Entity>
): SchemaChange[] {
  const creates: SchemaChange[] = []
  const cols: SchemaChange[] = []
  const fkDrops: SchemaChange[] = []
  const fkAdds: SchemaChange[] = []
  const drops: SchemaChange[] = []

  // New tables (columns only — FKs are emitted separately, below).
  for (const name of Object.keys(next)) {
    if (!(name in prev)) creates.push({kind: 'createTable', entity: next[name]})
  }

  // Column-level changes on tables present in both.
  for (const name of Object.keys(next)) {
    if (!(name in prev)) continue
    const before = columnsOf(prev[name])
    const after = columnsOf(next[name])
    const table = next[name].table

    for (const [col, spec] of after) {
      const prevSpec = before.get(col)
      if (!prevSpec) cols.push({kind: 'addColumn', table, column: spec})
      else if (!columnEqual(prevSpec, spec))
        cols.push({kind: 'alterColumn', table, before: prevSpec, after: spec})
    }
    for (const [col, spec] of before) {
      if (!after.has(col)) cols.push({kind: 'dropColumn', table, column: spec})
    }
  }

  // Foreign-key changes for every table present in `next` (new + existing).
  for (const name of Object.keys(next)) {
    const beforeFks = name in prev ? foreignKeysOf(prev[name], prev) : new Map<string, ForeignKeyChange>()
    const afterFks = foreignKeysOf(next[name], next)
    // Columns dropped from this table — their FKs vanish via DROP COLUMN cascade,
    // so we must NOT also emit an explicit DROP CONSTRAINT (it would fail).
    const droppedCols = new Set(
      name in prev
        ? [...columnsOf(prev[name]).keys()].filter(c => !columnsOf(next[name]).has(c))
        : []
    )

    for (const [fkName, fk] of afterFks) {
      const old = beforeFks.get(fkName)
      if (!old) fkAdds.push({kind: 'addForeignKey', fk})
      else if (!fkEqual(old, fk)) {
        // Retarget / onDelete change: drop then re-add (same constraint name).
        fkDrops.push({kind: 'dropForeignKey', fk: old})
        fkAdds.push({kind: 'addForeignKey', fk})
      }
    }
    for (const [fkName, fk] of beforeFks) {
      if (!afterFks.has(fkName) && !droppedCols.has(fk.column)) {
        fkDrops.push({kind: 'dropForeignKey', fk})
      }
    }
  }

  // Dropped tables. DROP TABLE cascades their constraints, so no explicit FK
  // drops; their columns (and inbound FK fidelity) are not restored on rollback.
  for (const name of Object.keys(prev)) {
    if (!(name in next)) drops.push({kind: 'dropTable', entity: prev[name]})
  }

  // Order: create tables → column changes → drop FKs → add FKs → drop tables.
  // Guarantees both endpoints of an FK exist before it's added, and that an FK
  // is dropped before its table; `down` (reverse) inverts this cleanly.
  return [...creates, ...cols, ...fkDrops, ...fkAdds, ...drops]
}

function addForeignKeySQL(fk: ForeignKeyChange): string {
  const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete.toUpperCase()}` : ''
  return (
    `ALTER TABLE "${fk.table}" ADD CONSTRAINT "${fk.name}" ` +
    `FOREIGN KEY ("${fk.column}") REFERENCES "${fk.refTable}" ("${fk.refColumn}")${onDelete}`
  )
}

function dropForeignKeySQL(fk: ForeignKeyChange): string {
  return `ALTER TABLE "${fk.table}" DROP CONSTRAINT "${fk.name}"`
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
    // Postgres names a single-column unique constraint `<table>_<column>_key`,
    // whether created inline or via ADD CONSTRAINT — so this round-trips with a
    // table created with the column already `UNIQUE`.
    const name = `${table}_${after.name}_key`
    out.push(
      after.unique
        ? `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" UNIQUE (${col})`
        : `ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`
    )
  }
  if (before.primaryKey !== after.primaryKey) {
    unsupported.push(
      `primary-key change on ${table}.${after.name} (${before.primaryKey} → ${after.primaryKey}) — recreate the table or manage the PK constraint explicitly`
    )
  }
  return out
}

function up(change: SchemaChange, unsupported: string[]): string[] {
  switch (change.kind) {
    case 'createTable':
      return [toDDL(change.entity)]
    case 'dropTable':
      return [`DROP TABLE "${change.entity.table}"`]
    case 'addColumn':
      return [`ALTER TABLE "${change.table}" ADD COLUMN ${columnDDL(change.column)}`]
    case 'dropColumn':
      return [`ALTER TABLE "${change.table}" DROP COLUMN "${change.column.name}"`]
    case 'alterColumn':
      return alterColumnSQL(change.table, change.before, change.after, unsupported)
    case 'addForeignKey':
      return [addForeignKeySQL(change.fk)]
    case 'dropForeignKey':
      return [dropForeignKeySQL(change.fk)]
  }
}

function down(change: SchemaChange, unsupported: string[]): string[] {
  switch (change.kind) {
    case 'createTable':
      return [`DROP TABLE "${change.entity.table}"`]
    case 'dropTable':
      return [toDDL(change.entity)]
    case 'addColumn':
      return [`ALTER TABLE "${change.table}" DROP COLUMN "${change.column.name}"`]
    case 'dropColumn':
      return [`ALTER TABLE "${change.table}" ADD COLUMN ${columnDDL(change.column)}`]
    case 'alterColumn':
      return alterColumnSQL(change.table, change.after, change.before, unsupported)
    case 'addForeignKey':
      return [dropForeignKeySQL(change.fk)]
    case 'dropForeignKey':
      return [addForeignKeySQL(change.fk)]
  }
}

/**
 * Render a set of changes to up + down SQL. Standalone (no prev/next maps), so a
 * migration's stored schema operation can render and reverse itself — every
 * change (including FKs) is self-contained.
 */
export function renderChanges(
  changes: SchemaChange[]
): {up: string[]; down: string[]; unsupported: string[]} {
  const unsupported: string[] = []
  const upSQL = changes.flatMap(c => up(c, unsupported))
  // `down` reverses the change order so dependent ops unwind correctly.
  const downSQL = [...changes].reverse().flatMap(c => down(c, []))
  return {up: upSQL, down: downSQL, unsupported}
}

/** Build a full migration (changes + up/down SQL) between two entity maps. */
export function makeMigration(
  prev: Record<string, Entity>,
  next: Record<string, Entity>
): Migration {
  const changes = diffEntities(prev, next)
  const {up, down, unsupported} = renderChanges(changes)
  return {changes, up, down, unsupported}
}
