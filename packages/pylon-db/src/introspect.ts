/**
 * Live-database introspection + drift detection.
 *
 * Drift = the actual DB schema diverging from what the migration history says it
 * should be. We compare at **presence level** (table and column names): reliable,
 * and free of the type-normalization minefield that makes deep introspection
 * brittle (Postgres reports `character varying`, identity columns, default
 * expressions, etc. in forms that don't trivially equal the model's intent).
 * Presence drift catches the cases that matter — a table/column the migrations
 * don't know about, or one the DB is missing — without false positives.
 *
 * This is only trustworthy because applied migrations are checksum-locked
 * (P2): "expected" is the folded history, and the history can't be edited
 * out from under us.
 */
import {sql} from 'kysely'
import {
  physicalSchemaOf,
  type ForeignKeyChange,
  type IndexSpec,
  type OnDelete,
  type PhysicalSchema,
  type PhysicalTable,
  type SqlType,
  type TableColumn
} from '@getcronit/pylon-ir'
import {getDatabase, type Database} from './database.js'
import {toIR} from './ir.js'

const LEDGER_TABLE = '_pylon_migrations'

/** Columns present in the live DB (public schema), keyed by table name. */
export async function introspect(db: Database = getDatabase()): Promise<Map<string, Set<string>>> {
  const rows = await sql<{table_name: string; column_name: string}>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `.execute(db.kysely)

  const out = new Map<string, Set<string>>()
  for (const {table_name, column_name} of rows.rows) {
    if (table_name === LEDGER_TABLE) continue
    if (!out.has(table_name)) out.set(table_name, new Set())
    out.get(table_name)!.add(column_name)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep introspection — reconstruct a full PhysicalSchema (columns + types + PK +
// FKs + unique) from a live database. Unlike presence-level drift (above), this
// is lossy by nature (Postgres normalizes types/defaults), so it is used only
// for `baseline` — a one-time adoption step a human reviews — never for diffing.
// ─────────────────────────────────────────────────────────────────────────────

interface RawColumn {
  table_name: string
  column_name: string
  data_type: string
  udt_name: string
  is_nullable: 'YES' | 'NO'
  column_default: string | null
  character_maximum_length: number | null
  is_identity: 'YES' | 'NO'
}

/** Map a Postgres type (data_type + udt_name) to the IR's SqlType vocabulary. */
function sqlTypeOf(data_type: string, udt_name: string): SqlType {
  switch (data_type) {
    case 'text':
      return 'text'
    case 'character varying':
    case 'character':
      return 'varchar'
    case 'integer':
    case 'smallint':
      return 'integer'
    case 'bigint':
      return 'bigint'
    case 'numeric':
    case 'real':
    case 'double precision':
      return 'numeric'
    case 'boolean':
      return 'boolean'
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return 'timestamptz'
    case 'date':
      return 'date'
    case 'json':
    case 'jsonb':
      return 'jsonb'
    case 'uuid':
      return 'uuid'
    default:
      // Array element types arrive as udt_name `_text`, `_int4`, … but the
      // caller handles `data_type === 'ARRAY'` before reaching here.
      return 'text'
  }
}

/** The element SqlType for an array column (udt_name like `_text`, `_int4`). */
function arrayElementType(udt_name: string): SqlType {
  const el = udt_name.replace(/^_/, '')
  switch (el) {
    case 'int4':
    case 'int2':
      return 'integer'
    case 'int8':
      return 'bigint'
    case 'numeric':
    case 'float4':
    case 'float8':
      return 'numeric'
    case 'bool':
      return 'boolean'
    case 'timestamptz':
    case 'timestamp':
      return 'timestamptz'
    case 'date':
      return 'date'
    case 'json':
    case 'jsonb':
      return 'jsonb'
    case 'uuid':
      return 'uuid'
    case 'varchar':
      return 'varchar'
    default:
      return 'text'
  }
}

const camel = (s: string): string =>
  s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

const mapOnDelete = (rule: string): OnDelete => {
  switch (rule) {
    case 'CASCADE':
      return 'cascade'
    case 'SET NULL':
      return 'set null'
    case 'RESTRICT':
      return 'restrict'
    default:
      return 'no action'
  }
}

/**
 * Reconstruct the live database's physical schema (public schema, excluding the
 * migration ledger). Single-column primary keys and unique constraints are
 * folded onto the column; multi-column unique constraints become unique indexes;
 * foreign keys carry their `ON DELETE` rule. Non-unique secondary indexes and
 * composite primary keys are out of scope (a human reviews the baseline output).
 */
export async function introspectPhysical(
  db: Database = getDatabase()
): Promise<PhysicalSchema> {
  const columns = await sql<RawColumn>`
    SELECT table_name, column_name, data_type, udt_name, is_nullable,
           column_default, character_maximum_length, is_identity
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `.execute(db.kysely)

  // Primary-key columns, per table (constraint name + columns).
  const pks = await sql<{table_name: string; column_name: string}>`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
  `.execute(db.kysely)

  // Unique constraints (single + composite), per constraint.
  const uniques = await sql<{
    table_name: string
    constraint_name: string
    column_name: string
    ordinal_position: number
  }>`
    SELECT tc.table_name, tc.constraint_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'UNIQUE'
    ORDER BY tc.constraint_name, kcu.ordinal_position
  `.execute(db.kysely)

  // Foreign keys (single-column) with their referenced table/column + delete rule.
  const fks = await sql<{
    table_name: string
    constraint_name: string
    column_name: string
    ref_table: string
    ref_column: string
    delete_rule: string
  }>`
    SELECT tc.table_name, tc.constraint_name, kcu.column_name,
           ccu.table_name AS ref_table, ccu.column_name AS ref_column,
           rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
  `.execute(db.kysely)

  // Index the constraint metadata by table.
  const pkCols = new Map<string, Set<string>>()
  for (const r of pks.rows) {
    if (!pkCols.has(r.table_name)) pkCols.set(r.table_name, new Set())
    pkCols.get(r.table_name)!.add(r.column_name)
  }

  const uniqueByConstraint = new Map<string, {table: string; columns: string[]}>()
  for (const r of uniques.rows) {
    const u = uniqueByConstraint.get(r.constraint_name) ?? {table: r.table_name, columns: []}
    u.columns.push(r.column_name)
    uniqueByConstraint.set(r.constraint_name, u)
  }
  const singleUnique = new Map<string, Set<string>>() // table → cols with a 1-col UNIQUE
  const compositeUnique: Array<{table: string; name: string; columns: string[]}> = []
  for (const [name, u] of uniqueByConstraint) {
    if (u.columns.length === 1) {
      if (!singleUnique.has(u.table)) singleUnique.set(u.table, new Set())
      singleUnique.get(u.table)!.add(u.columns[0])
    } else {
      compositeUnique.push({table: u.table, name, columns: u.columns})
    }
  }

  const fkByTable = new Map<string, ForeignKeyChange[]>()
  for (const r of fks.rows) {
    const list = fkByTable.get(r.table_name) ?? []
    list.push({
      table: r.table_name,
      name: r.constraint_name,
      column: r.column_name,
      refTable: r.ref_table,
      refColumn: r.ref_column,
      onDelete: mapOnDelete(r.delete_rule)
    })
    fkByTable.set(r.table_name, list)
  }

  // Assemble one PhysicalTable per table.
  const schema: PhysicalSchema = {}
  for (const c of columns.rows) {
    if (c.table_name === LEDGER_TABLE) continue
    let table = schema[c.table_name]
    if (!table) {
      table = {name: c.table_name, table: c.table_name, columns: [], foreignKeys: [], indexes: []}
      schema[c.table_name] = table
    }
    const isArray = c.data_type === 'ARRAY'
    const tablePks = pkCols.get(c.table_name)
    const isPk = !!tablePks && tablePks.size === 1 && tablePks.has(c.column_name)
    const isSerial =
      c.is_identity === 'YES' || (c.column_default?.includes('nextval(') ?? false)
    const col: TableColumn = {
      property: camel(c.column_name),
      name: c.column_name,
      sqlType: isArray ? arrayElementType(c.udt_name) : sqlTypeOf(c.data_type, c.udt_name),
      primaryKey: isPk,
      autoIncrement: isPk && isSerial,
      unique: singleUnique.get(c.table_name)?.has(c.column_name) ?? false,
      nullable: c.is_nullable === 'YES',
      ...(isArray ? {array: true} : {}),
      ...(c.character_maximum_length ? {length: c.character_maximum_length} : {})
    }
    table.columns.push(col)
  }

  for (const [tableName, fkList] of fkByTable) {
    if (schema[tableName]) schema[tableName].foreignKeys = fkList
  }
  for (const u of compositeUnique) {
    const t = schema[u.table]
    if (!t) continue
    const idx: IndexSpec = {
      name: u.name,
      table: u.table,
      columns: u.columns,
      unique: true
    }
    t.indexes = [...(t.indexes ?? []), idx]
  }
  return schema
}

/** The expected column-presence map (by table name) from a model schema. */
export function expectedColumns(schema: PhysicalSchema): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const table of Object.values(schema)) {
    out.set(table.table, new Set(table.columns.map(c => c.name)))
  }
  return out
}

export interface SchemaDrift {
  /** Tables the models expect but the DB lacks. */
  missingTables: string[]
  /** Tables in the DB the models don't define. */
  extraTables: string[]
  /** Per-table column presence drift (for tables in both). */
  columns: Array<{table: string; missing: string[]; extra: string[]}>
}

/** Compare the live DB (`actual`) to the expected schema, at presence level. */
export function computeDrift(
  actual: Map<string, Set<string>>,
  expected: Map<string, Set<string>>
): SchemaDrift {
  const missingTables = [...expected.keys()].filter(t => !actual.has(t)).sort()
  const extraTables = [...actual.keys()].filter(t => !expected.has(t)).sort()
  const columns: SchemaDrift['columns'] = []
  for (const [table, want] of expected) {
    const have = actual.get(table)
    if (!have) continue
    const missing = [...want].filter(c => !have.has(c)).sort()
    const extra = [...have].filter(c => !want.has(c)).sort()
    if (missing.length || extra.length) columns.push({table, missing, extra})
  }
  return {missingTables, extraTables, columns}
}

/** Whether any drift was detected. */
export function hasDrift(d: SchemaDrift): boolean {
  return d.missingTables.length > 0 || d.extraTables.length > 0 || d.columns.length > 0
}

/** Drift between the live DB and the current models (presence level). */
export async function schemaDrift(db: Database = getDatabase()): Promise<SchemaDrift> {
  const actual = await introspect(db)
  const expected = expectedColumns(physicalSchemaOf(toIR().entities))
  return computeDrift(actual, expected)
}
