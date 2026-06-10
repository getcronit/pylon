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
import {tableSpecOf} from './ir.js'
import type {
  ColumnSpec,
  Entity,
  ForeignKeyChange,
  IndexSpec,
  PhysicalSchema,
  PhysicalTable,
  TableColumn,
  TableSpec
} from './ir.js'

export type SchemaChange =
  | {kind: 'createTable'; spec: TableSpec}
  | {kind: 'dropTable'; spec: TableSpec}
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

// ── PhysicalSchema: the canonical state currency ────────────────────────────

/** Project IR entities to their physical schema (columns + FKs + indexes). */
export function physicalSchemaOf(entities: Record<string, Entity>): PhysicalSchema {
  const schema: PhysicalSchema = {}
  for (const name of Object.keys(entities)) {
    const e = entities[name]
    schema[name] = {
      ...tableSpecOf(e), // {name, table, columns}
      foreignKeys: [...foreignKeysOf(e, entities).values()],
      indexes: [...indexesOf(e).values()]
    }
  }
  return schema
}

const pColumns = (t: PhysicalTable): Map<string, TableColumn> =>
  new Map(t.columns.map(c => [c.name, c]))
const pFks = (t: PhysicalTable): Map<string, ForeignKeyChange> =>
  new Map((t.foreignKeys ?? []).map(fk => [fk.name, fk]))
const pIndexes = (t: PhysicalTable): Map<string, IndexSpec> =>
  new Map((t.indexes ?? []).map(ix => [ix.name, ix]))

/** The lean `TableSpec` slice of a physical table (for create/dropTable). */
const tableSpecPart = (t: PhysicalTable): TableSpec => ({
  name: t.name,
  table: t.table,
  columns: t.columns
})

/**
 * Compute the ordered set of changes from one physical schema to another. This
 * is THE diff — `from` and `to` can each come from projecting models, folding op
 * history, or introspecting a live DB. FKs/indexes are already explicit on each
 * table, so there's no relation resolution here.
 */
export interface Rename {
  table: string
  from: string
  to: string
}

export function diffSchema(
  prev: PhysicalSchema,
  next: PhysicalSchema,
  opts: {renames?: Rename[]} = {}
): SchemaChange[] {
  const creates: SchemaChange[] = []
  const cols: SchemaChange[] = []
  const fkDrops: SchemaChange[] = []
  const fkAdds: SchemaChange[] = []
  const indexDrops: SchemaChange[] = []
  const indexAdds: SchemaChange[] = []
  const drops: SchemaChange[] = []

  // New tables (columns only — FKs/indexes are emitted separately, below).
  for (const name of Object.keys(next)) {
    if (!(name in prev)) creates.push({kind: 'createTable', spec: tableSpecPart(next[name])})
  }

  // Column-level changes on tables present in both.
  for (const name of Object.keys(next)) {
    if (!(name in prev)) continue
    const before = pColumns(prev[name])
    const after = pColumns(next[name])
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
    const beforeFks = name in prev ? pFks(prev[name]) : new Map<string, ForeignKeyChange>()
    const afterFks = pFks(next[name])
    // Columns dropped from this table — their FKs vanish via DROP COLUMN cascade,
    // so we must NOT also emit an explicit DROP CONSTRAINT (it would fail).
    const droppedCols = new Set(
      name in prev
        ? [...pColumns(prev[name]).keys()].filter(c => !pColumns(next[name]).has(c))
        : []
    )

    for (const [fkName, fk] of afterFks) {
      const old = beforeFks.get(fkName)
      if (!old) fkAdds.push({kind: 'addForeignKey', fk})
      else if (!fkEqual(old, fk)) {
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
    const beforeIx = name in prev ? pIndexes(prev[name]) : new Map<string, IndexSpec>()
    const afterIx = pIndexes(next[name])
    const droppedCols = new Set(
      name in prev
        ? [...pColumns(prev[name]).keys()].filter(c => !pColumns(next[name]).has(c))
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
      if (!afterIx.has(ixName) && !ix.columns.some(c => droppedCols.has(c))) {
        indexDrops.push({kind: 'dropIndex', index: ix})
      }
    }
  }

  // Apply rename hints: a `dropColumn(from)` + `addColumn(to)` pair the diff
  // can't tell from a real rename is replaced by a data-preserving renameColumn.
  for (const {table, from, to} of opts.renames ?? []) {
    const di = cols.findIndex(c => c.kind === 'dropColumn' && c.table === table && c.column.name === from)
    const ai = cols.findIndex(c => c.kind === 'addColumn' && c.table === table && c.column.name === to)
    if (di >= 0 && ai >= 0) {
      // splice the higher index first so the lower stays valid
      cols.splice(Math.max(di, ai), 1)
      cols.splice(Math.min(di, ai), 1)
      cols.push({kind: 'renameColumn', table, from, to})
    }
  }

  // Dropped tables. DROP TABLE cascades their constraints + indexes.
  for (const name of Object.keys(prev)) {
    if (!(name in next)) drops.push({kind: 'dropTable', spec: tableSpecPart(prev[name])})
  }

  // Order: create tables → column changes → drop FKs/indexes → add FKs/indexes
  // → drop tables. Guarantees a constraint/index's columns exist before it's
  // added, and that it's dropped before its table; `down` inverts this cleanly.
  return [...creates, ...cols, ...fkDrops, ...indexDrops, ...fkAdds, ...indexAdds, ...drops]
}

/** Diff two IR entity maps (convenience wrapper over `diffSchema`). */
export function diffEntities(
  prev: Record<string, Entity>,
  next: Record<string, Entity>
): SchemaChange[] {
  return diffSchema(physicalSchemaOf(prev), physicalSchemaOf(next))
}

/** Whether a change destroys data (drops a table or column). */
export function isDestructive(change: SchemaChange): boolean {
  return change.kind === 'dropTable' || change.kind === 'dropColumn'
}

/**
 * Heuristic rename detection: a `dropColumn` + `addColumn` of the same SQL type
 * on the same table looks like it *might* be a rename (the diff can't tell, and
 * would otherwise destroy data). Returned so tooling can warn / prompt; pass the
 * confirmed ones back via `diffSchema`'s `renames`.
 */
export function renameCandidates(changes: SchemaChange[]): Rename[] {
  const byTable = new Map<string, {drops: ColumnSpec[]; adds: ColumnSpec[]}>()
  for (const c of changes) {
    if (c.kind !== 'dropColumn' && c.kind !== 'addColumn') continue
    const t = byTable.get(c.table) ?? {drops: [], adds: []}
    ;(c.kind === 'dropColumn' ? t.drops : t.adds).push(c.column)
    byTable.set(c.table, t)
  }
  const out: Rename[] = []
  for (const [table, {drops, adds}] of byTable) {
    const used = new Set<ColumnSpec>()
    for (const d of drops) {
      const a = adds.find(x => !used.has(x) && x.sqlType === d.sqlType)
      if (a) {
        used.add(a)
        out.push({table, from: d.name, to: a.name})
      }
    }
  }
  return out
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
      return [toDDL(change.spec)]
    case 'dropTable':
      return [`DROP TABLE "${change.spec.table}"`]
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
      return [`DROP TABLE "${change.spec.table}"`]
    case 'dropTable':
      return [toDDL(change.spec)]
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
 * Fold a set of schema changes into a `PhysicalSchema` — the inverse direction
 * of `diffSchema`, and the "state" projection (Django's `state_forwards`).
 * Replaying a migration history's changes reconstructs the full physical schema
 * as of any point, *without* a database — this is the canonical baseline (no
 * `snapshot.json`) and the source of historical models for data migrations.
 *
 * Columns added via `addColumn` may carry their `property` (when the diff
 * sourced it from a physical table); otherwise the column name is used.
 */
export function applyChanges(
  schema: PhysicalSchema,
  changes: SchemaChange[]
): PhysicalSchema {
  const next: PhysicalSchema = {...schema}
  const byTable = (table: string): PhysicalTable | undefined =>
    Object.values(next).find(t => t.table === table)
  const patch = (t: PhysicalTable, p: Partial<PhysicalTable>) => {
    next[t.name] = {...t, ...p}
  }

  for (const c of changes) {
    switch (c.kind) {
      case 'createTable':
        next[c.spec.name] = {...c.spec, foreignKeys: [], indexes: []}
        break
      case 'dropTable':
        delete next[c.spec.name]
        break
      case 'addColumn': {
        const t = byTable(c.table)
        if (!t) break
        const col: TableColumn = {property: c.column.name, ...c.column}
        patch(t, {columns: [...t.columns.filter(x => x.name !== c.column.name), col]})
        break
      }
      case 'dropColumn': {
        const t = byTable(c.table)
        if (t) patch(t, {columns: t.columns.filter(x => x.name !== c.column.name)})
        break
      }
      case 'alterColumn': {
        const t = byTable(c.table)
        if (t)
          patch(t, {
            columns: t.columns.map(x =>
              x.name === c.after.name ? {property: x.property, ...c.after} : x
            )
          })
        break
      }
      case 'renameColumn': {
        const t = byTable(c.table)
        if (t)
          patch(t, {
            columns: t.columns.map(x =>
              x.name === c.from
                ? {...x, name: c.to, property: x.property === c.from ? c.to : x.property}
                : x
            )
          })
        break
      }
      case 'addForeignKey': {
        const t = byTable(c.fk.table)
        if (t)
          patch(t, {foreignKeys: [...(t.foreignKeys ?? []).filter(f => f.name !== c.fk.name), c.fk]})
        break
      }
      case 'dropForeignKey': {
        const t = byTable(c.fk.table)
        if (t) patch(t, {foreignKeys: (t.foreignKeys ?? []).filter(f => f.name !== c.fk.name)})
        break
      }
      case 'addIndex': {
        const t = byTable(c.index.table)
        if (t)
          patch(t, {indexes: [...(t.indexes ?? []).filter(i => i.name !== c.index.name), c.index]})
        break
      }
      case 'dropIndex': {
        const t = byTable(c.index.table)
        if (t) patch(t, {indexes: (t.indexes ?? []).filter(i => i.name !== c.index.name)})
        break
      }
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
