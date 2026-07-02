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
import {postgres} from './dialect.js'
import {joinColumn, joinTableName, pgIdent, tableSpecOf} from './ir.js'
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
  // Table rename — also authoring-only. `from`/`to` are the IR keys (model names,
  // how the snapshot is keyed); `fromTable`/`toTable` are the physical table names
  // (what the SQL renames). A class rename changes BOTH, so both are carried: the
  // SQL renames the physical table, the snapshot re-keys + updates `.table`. Nested
  // index/FK names (which embed the old table) are left as-is — a follow-up diff
  // reconciles them via safe drop/recreate.
  | {kind: 'renameTable'; from: string; to: string; fromTable: string; toTable: string}

export interface Migration {
  changes: SchemaChange[]
  up: string[]
  down: string[]
  /** Human-readable notes for deltas the engine cannot express as SQL. */
  unsupported: string[]
}

/** Structural equality for column default *values* (which may be arrays/objects,
 *  e.g. a `text[]` column's `[]` default — `[] === []` is reference-false, so a
 *  bare `===` would diff every array column against itself forever). */
function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => valueEqual(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object)
    const bk = Object.keys(b as object)
    return (
      ak.length === bk.length &&
      ak.every(k => valueEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    )
  }
  return false
}

function columnEqual(a: ColumnSpec, b: ColumnSpec): boolean {
  return (
    a.sqlType === b.sqlType &&
    !!a.array === !!b.array &&
    a.nullable === b.nullable &&
    a.unique === b.unique &&
    a.primaryKey === b.primaryKey &&
    a.length === b.length &&
    a.precision === b.precision &&
    a.scale === b.scale &&
    a.generatedAs === b.generatedAs &&
    a.defaultSql === b.defaultSql &&
    valueEqual(a.default, b.default) &&
    a.check === b.check
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
    const name = pgIdent(`${e.table}_${column}_fkey`)
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
    (a.method ?? 'btree') === (b.method ?? 'btree') &&
    (a.ops ?? '') === (b.ops ?? '') &&
    a.columns.length === b.columns.length &&
    a.columns.every((c, i) => c === b.columns[i])
  )
}

// ── PhysicalSchema: the canonical state currency ────────────────────────────

/**
 * Project IR entities to their physical schema (columns + FKs + indexes).
 *
 * `resolveAgainst` is the universe used to resolve `belongsTo` FK *targets*; it
 * defaults to the materialized `entities`. They differ for a **per-app** schema:
 * `entities` is the app's own (the tables it owns / migrates), while
 * `resolveAgainst` is all apps' entities — so a cross-app FK whose target lives
 * in another app still resolves instead of being silently dropped. Only
 * `entities` become tables; `resolveAgainst` is lookup-only.
 */
export function physicalSchemaOf(
  entities: Record<string, Entity>,
  resolveAgainst: Record<string, Entity> = entities
): PhysicalSchema {
  const schema: PhysicalSchema = {}
  for (const name of Object.keys(entities)) {
    const e = entities[name]
    schema[name] = {
      ...tableSpecOf(e), // {name, table, columns}
      foreignKeys: [...foreignKeysOf(e, resolveAgainst).values()],
      indexes: [...indexesOf(e).values()]
    }
  }
  // Many-to-many join tables are not entities: synthesize them from the m2m
  // relations declared on either side. Keyed by the (deterministic) join-table
  // name so the two sides collapse to one table.
  for (const [joinT, table] of joinTablesOf(entities, resolveAgainst)) {
    if (!schema[joinT]) schema[joinT] = table
  }
  return schema
}

/**
 * Synthesize the implicit join tables backing every `manyToMany` relation. Each
 * join table carries two non-null FK columns (`<table>_<pk>`), both referenced
 * by a composite UNIQUE index, with `ON DELETE CASCADE` to either side. The
 * derivation is deterministic (sorted table names) so both relation sides — and
 * every fold/diff — agree on a single table.
 */
function joinTablesOf(
  entities: Record<string, Entity>,
  resolveAgainst: Record<string, Entity>
): Map<string, PhysicalTable> {
  const out = new Map<string, PhysicalTable>()
  const pkColOf = (e: Entity): ColumnSpec | undefined =>
    e.fields.find(f => f.name === e.primaryKey)?.column
  for (const e of Object.values(entities)) {
    const aPk = pkColOf(e)
    if (!aPk) continue
    for (const f of e.fields) {
      const rel = f.relation
      // The inverse side is an accessor only — the canonical side owns (and
      // synthesizes) the join table, so skip it here to avoid a double-create.
      if (rel?.kind !== 'manyToMany' || rel.inverse) continue
      const target = resolveAgainst[rel.target]
      const bPk = target && pkColOf(target)
      if (!target || !bPk) continue
      const joinT = joinTableName(e.table, target.table, rel.through)
      if (out.has(joinT)) continue
      const aCol = rel.sourceColumn ?? joinColumn(e.table, aPk.name)
      const bCol = rel.targetColumn ?? joinColumn(target.table, bPk.name)
      const col = (name: string, src: ColumnSpec): TableColumn => ({
        property: name,
        name,
        sqlType: src.sqlType,
        primaryKey: false,
        autoIncrement: false,
        unique: false,
        nullable: false
      })
      out.set(joinT, {
        name: joinT,
        table: joinT,
        columns: [col(aCol, aPk), col(bCol, bPk)],
        foreignKeys: [
          {
            table: joinT,
            name: pgIdent(`${joinT}_${aCol}_fkey`),
            column: aCol,
            refTable: e.table,
            refColumn: aPk.name,
            onDelete: 'cascade'
          },
          {
            table: joinT,
            name: pgIdent(`${joinT}_${bCol}_fkey`),
            column: bCol,
            refTable: target.table,
            refColumn: bPk.name,
            onDelete: 'cascade'
          }
        ],
        indexes: [
          {
            name: pgIdent(`${joinT}_${aCol}_${bCol}_key`),
            table: joinT,
            columns: [aCol, bCol],
            unique: true
          }
        ]
      })
    }
  }
  return out
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

/** A table rename hint (`from`/`to` are the IR keys — model names). */
export interface TableRename {
  from: string
  to: string
}

export function diffSchema(
  prev: PhysicalSchema,
  next: PhysicalSchema,
  opts: {renames?: Rename[]; tableRenames?: TableRename[]} = {}
): SchemaChange[] {
  const renameTables: SchemaChange[] = []

  // Apply table-rename hints FIRST: remap prev[from] → prev[to] so the normal
  // column/FK/index diffs treat it as the SAME table (emitting the rename + the
  // dependent-object name reconciliation in one pass, data-preserving). The entry's
  // physical `.table` — and its nested FK/index `.table` — move to the NEW table so
  // their drops target the renamed table; NAMES stay old so they diff to the model's
  // derived names (safe drop/recreate). Renamed COLUMNS still surface as drop+add and
  // need their own `renames` hint to stay data-preserving.
  if (opts.tableRenames?.length) {
    prev = {...prev}
    for (const {from, to} of opts.tableRenames) {
      const src = prev[from]
      const dst = next[to]
      if (!src || !dst || prev[to]) continue
      const toTable = dst.table
      delete prev[from]
      prev[to] = {
        ...src,
        name: to,
        table: toTable,
        foreignKeys: (src.foreignKeys ?? []).map(fk => ({...fk, table: toTable})),
        indexes: (src.indexes ?? []).map(ix => ({...ix, table: toTable}))
      }
      renameTables.push({kind: 'renameTable', from, to, fromTable: src.table, toTable})
    }
  }

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
  return [...renameTables, ...creates, ...cols, ...fkDrops, ...indexDrops, ...fkAdds, ...indexAdds, ...drops]
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

/**
 * Heuristic TABLE rename detection: a `dropTable` + `createTable` whose column-name
 * sets are identical is almost certainly a rename (the diff otherwise destroys the
 * whole table's data). Returned so tooling can warn / prompt; pass confirmed ones
 * back via `diffSchema`'s `tableRenames`. Conservative — an exact column-name match
 * avoids false positives; a rename that also renamed a column needs a manual hint.
 */
export function tableRenameCandidates(changes: SchemaChange[]): TableRename[] {
  const drops = changes.flatMap(c => (c.kind === 'dropTable' ? [c.spec] : []))
  const creates = changes.flatMap(c => (c.kind === 'createTable' ? [c.spec] : []))
  const cols = (spec: {columns: {name: string}[]}) =>
    spec.columns.map(c => c.name).sort().join(',')
  const out: TableRename[] = []
  const used = new Set<string>()
  for (const d of drops) {
    const sig = cols(d)
    const c = creates.find(x => !used.has(x.name) && cols(x) === sig)
    if (c) {
      used.add(c.name)
      out.push({from: d.name, to: c.name})
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
  // `IF EXISTS` for the same reason as dropIndexSQL below: a foreign-key
  // constraint vanishes out-of-band when its column is dropped (Postgres
  // cascades the constraint), so a later diff can emit a phantom drop for a
  // constraint that's already gone — without `IF EXISTS` that aborts the migration.
  return `ALTER TABLE "${fk.table}" DROP CONSTRAINT IF EXISTS "${fk.name}"`
}

function addIndexSQL(ix: IndexSpec): string[] {
  const out: string[] = []
  // A `gin_trgm_ops` index needs the pg_trgm extension; ensure it (idempotent).
  if (ix.ops === 'gin_trgm_ops') out.push('CREATE EXTENSION IF NOT EXISTS pg_trgm')
  const cols = ix.columns.map(c => `"${c}"${ix.ops ? ` ${ix.ops}` : ''}`).join(', ')
  out.push(
    `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX "${ix.name}" ON "${ix.table}"${postgres.indexMethod(ix.method)} (${cols})`
  )
  return out
}

function dropIndexSQL(ix: IndexSpec): string {
  // `IF EXISTS` keeps the drop idempotent: an index can vanish out-of-band when
  // its column/table is dropped (Postgres cascades index removal), leaving a
  // snapshot that still lists it. The next diff then emits a phantom drop for an
  // index that's already gone — without `IF EXISTS` that aborts the migration.
  return `DROP INDEX IF EXISTS "${ix.name}"`
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
  if (before.check !== after.check) {
    // Postgres names a column check `<table>_<column>_check`; round-trips with
    // an inline CHECK created on the column.
    const name = `${table}_${after.name}_check`
    if (before.check) out.push(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`)
    if (after.check) out.push(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${after.check})`)
  }
  if (before.generatedAs !== after.generatedAs) {
    if (before.generatedAs && after.generatedAs) {
      // Re-point a STORED generated column's expression in place — PG17+
      // (`SET EXPRESSION`). This recomputes every row and, crucially, preserves
      // dependent objects like the column's GIN index (a DROP/ADD COLUMN would
      // CASCADE them away). This is the path a `@model({search})` language /
      // column-set change takes.
      out.push(`${t} SET EXPRESSION AS (${after.generatedAs})`)
    } else {
      // Adding or removing generated-ness entirely changes the column's storage
      // contract — author an explicit drop & re-add rather than guess.
      unsupported.push(
        `generated-column add/remove on ${table}.${after.name} — drop & re-add the column explicitly`
      )
    }
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
      return addIndexSQL(change.index)
    case 'dropIndex':
      return [dropIndexSQL(change.index)]
    case 'renameColumn':
      return [`ALTER TABLE "${change.table}" RENAME COLUMN "${change.from}" TO "${change.to}"`]
    case 'renameTable':
      return [`ALTER TABLE "${change.fromTable}" RENAME TO "${change.toTable}"`]
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
      return addIndexSQL(change.index)
    case 'renameColumn':
      return [`ALTER TABLE "${change.table}" RENAME COLUMN "${change.to}" TO "${change.from}"`]
    case 'renameTable':
      return [`ALTER TABLE "${change.toTable}" RENAME TO "${change.fromTable}"`]
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
      case 'renameTable': {
        // Re-key from the old model name to the new one and update the physical
        // `table` — on the entry AND its nested indexes/FKs (Postgres keeps those
        // attached to the renamed table under their OLD names). We keep the old
        // NAMES so a follow-up diff reconciles them to the model's derived names via
        // a safe drop/recreate; but the `.table` must point at the new physical name
        // so that drop targets an existing table.
        const t = next[c.from]
        if (t) {
          delete next[c.from]
          next[c.to] = {
            ...t,
            name: c.to,
            table: c.toTable,
            indexes: (t.indexes ?? []).map(ix => ({...ix, table: c.toTable})),
            foreignKeys: (t.foreignKeys ?? []).map(fk => ({...fk, table: c.toTable}))
          }
        }
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
