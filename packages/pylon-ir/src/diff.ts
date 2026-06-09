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
import type {ColumnSpec, Entity, Field, IndexSpec, OnDelete} from './ir.js'

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
  | {kind: 'addIndex'; index: IndexSpec}
  | {kind: 'dropIndex'; index: IndexSpec}
  // Rename is authoring-only — the diff can't infer it (it sees drop+add), but
  // a hand-written migration can express it (and it preserves the column data).
  | {kind: 'renameColumn'; table: string; from: string; to: string}

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

/** Indexes declared on an entity, keyed by name. */
function indexesOf(e: Entity): Map<string, IndexSpec> {
  return new Map((e.indexes ?? []).map(ix => [ix.name, ix]))
}

function indexEqual(a: IndexSpec, b: IndexSpec): boolean {
  return (
    !!a.unique === !!b.unique &&
    a.columns.length === b.columns.length &&
    a.columns.every((c, i) => c === b.columns[i])
  )
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
  const indexDrops: SchemaChange[] = []
  const indexAdds: SchemaChange[] = []
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

  // Index changes for every table present in `next` (new + existing).
  for (const name of Object.keys(next)) {
    const beforeIx = name in prev ? indexesOf(prev[name]) : new Map<string, IndexSpec>()
    const afterIx = indexesOf(next[name])
    const droppedCols = new Set(
      name in prev
        ? [...columnsOf(prev[name]).keys()].filter(c => !columnsOf(next[name]).has(c))
        : []
    )
    for (const [ixName, ix] of afterIx) {
      const old = beforeIx.get(ixName)
      if (!old) indexAdds.push({kind: 'addIndex', index: ix})
      else if (!indexEqual(old, ix)) {
        indexDrops.push({kind: 'dropIndex', index: old})
        indexAdds.push({kind: 'addIndex', index: ix})
      }
    }
    for (const [ixName, ix] of beforeIx) {
      // A dropped column cascades its indexes, so skip an explicit DROP INDEX.
      if (!afterIx.has(ixName) && !ix.columns.some(c => droppedCols.has(c))) {
        indexDrops.push({kind: 'dropIndex', index: ix})
      }
    }
  }

  // Dropped tables. DROP TABLE cascades their constraints + indexes, so no
  // explicit FK/index drops; their columns (and inbound FK fidelity) are not
  // restored on rollback.
  for (const name of Object.keys(prev)) {
    if (!(name in next)) drops.push({kind: 'dropTable', entity: prev[name]})
  }

  // Order: create tables → column changes → drop FKs/indexes → add FKs/indexes
  // → drop tables. Guarantees a constraint/index's columns exist before it's
  // added, and that it's dropped before its table; `down` inverts this cleanly.
  return [...creates, ...cols, ...fkDrops, ...indexDrops, ...fkAdds, ...indexAdds, ...drops]
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

function addIndexSQL(ix: IndexSpec): string {
  const cols = ix.columns.map(c => `"${c}"`).join(', ')
  return `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX "${ix.name}" ON "${ix.table}" (${cols})`
}

function dropIndexSQL(ix: IndexSpec): string {
  return `DROP INDEX "${ix.name}"`
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
    case 'addIndex':
      return [addIndexSQL(change.index)]
    case 'dropIndex':
      return [dropIndexSQL(change.index)]
    case 'renameColumn':
      return [`ALTER TABLE "${change.table}" RENAME COLUMN "${change.from}" TO "${change.to}"`]
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
    case 'addIndex':
      return [dropIndexSQL(change.index)]
    case 'dropIndex':
      return [addIndexSQL(change.index)]
    case 'renameColumn':
      return [`ALTER TABLE "${change.table}" RENAME COLUMN "${change.to}" TO "${change.from}"`]
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

/**
 * Fold a set of schema changes into an entity map — the inverse direction of
 * `diffEntities`. This is the "state" projection (Django's `state_forwards`):
 * replaying a migration history's changes reconstructs the schema as of any
 * point, *without* reading the live models. Used to build historical models for
 * data migrations.
 *
 * Only column/table shape is tracked (what a query manager needs); foreign-key
 * and index changes are no-ops here — they don't affect a row's columns. Columns
 * added via `addColumn` carry only a `ColumnSpec`, so their reconstructed field
 * uses the column name as the property name (createTable-origin fields keep
 * their real property names).
 */
export function applyChanges(
  entities: Record<string, Entity>,
  changes: SchemaChange[]
): Record<string, Entity> {
  const next = {...entities}
  const byTable = (table: string): Entity | undefined =>
    Object.values(next).find(e => e.table === table)
  const replaceFields = (e: Entity, fields: Field[]) => {
    next[e.name] = {...e, fields}
  }

  for (const c of changes) {
    switch (c.kind) {
      case 'createTable':
        next[c.entity.name] = c.entity
        break
      case 'dropTable':
        delete next[c.entity.name]
        break
      case 'addColumn': {
        const e = byTable(c.table)
        if (!e) break
        const field: Field = {
          name: c.column.name,
          type: {kind: 'scalar', name: 'String', nullable: c.column.nullable},
          exposed: true,
          column: c.column
        }
        replaceFields(e, [...e.fields.filter(f => f.column?.name !== c.column.name), field])
        break
      }
      case 'dropColumn': {
        const e = byTable(c.table)
        if (e) replaceFields(e, e.fields.filter(f => f.column?.name !== c.column.name))
        break
      }
      case 'alterColumn': {
        const e = byTable(c.table)
        if (e)
          replaceFields(
            e,
            e.fields.map(f => (f.column?.name === c.after.name ? {...f, column: c.after} : f))
          )
        break
      }
      case 'renameColumn': {
        const e = byTable(c.table)
        if (e)
          replaceFields(
            e,
            e.fields.map(f =>
              f.column?.name === c.from
                ? {...f, name: f.name === c.from ? c.to : f.name, column: {...f.column!, name: c.to}}
                : f
            )
          )
        break
      }
      // addForeignKey / dropForeignKey / addIndex / dropIndex: no effect on the
      // column shape a query manager needs.
    }
  }
  return next
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
