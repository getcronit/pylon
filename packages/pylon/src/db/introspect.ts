/**
 * Live-database introspection + drift detection.
 *
 * Drift = the actual DB schema diverging from what the migration history says it
 * should be. Compared on two levels:
 *
 *   - PRESENCE (table and column names) — something added or missing entirely.
 *   - SHAPE (`computeDeepDrift`) — a column that exists under the right name but
 *     no longer has the type, nullability, uniqueness or primary-key-ness the
 *     models expect, a foreign key missing or retargeted, an index absent.
 *
 * Shape used to be out of scope for fear of "the type-normalization minefield".
 * Measuring it settled the question: `introspectPhysical` reproduces sqlType,
 * array, nullable, unique, primaryKey, autoIncrement, length, precision and scale
 * faithfully, plus foreign keys including ON DELETE. Only DB-side defaults,
 * CHECK constraints and generated expressions can't be recovered — those are
 * excluded by name (see `COMPARABLE`) rather than the whole comparison abandoned.
 * Presence alone called a column hand-altered from `text` to `integer` "in sync",
 * which is precisely the drift you most want to hear about.
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
} from '../ir'
import {getDatabase, type Database} from './database.js'
import {toIR} from './ir.js'

const LEDGER_TABLE = '_pylon_migrations'

/**
 * Marker for "this column is GENERATED, but we can't compare the expression".
 * Postgres normalises a generated expression (casts, quoting, column
 * qualification), so the stored text never equals the model's source string.
 */
export const GENERATED_UNKNOWN = '<generated>'

/** Migration-ledger / framework bookkeeping tables to never surface as models
 *  (incl. the queues transactional-outbox table). */
const IGNORED_TABLES = new Set([LEDGER_TABLE, '_pylon_outbox', '_prisma_migrations'])

/** Columns present in the live DB (public schema), keyed by table name. */
export async function introspect(db: Database = getDatabase()): Promise<Map<string, Set<string>>> {
  const rows = await sql<{table_name: string; column_name: string}>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `.execute(db.kysely)

  const out = new Map<string, Set<string>>()
  for (const {table_name, column_name} of rows.rows) {
    if (IGNORED_TABLES.has(table_name)) continue // framework tables (ledger, outbox)
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
  numeric_precision: number | null
  numeric_scale: number | null
  is_identity: 'YES' | 'NO'
  is_generated: string | null
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
      // Extension + specialised types arrive as `USER-DEFINED` with the real name
      // on `udt_name`. Without these they fell through to `text`, which reads as a
      // type change on every tsvector/pgvector column.
      if (udt_name === 'tsvector') return 'tsvector'
      if (udt_name === 'vector') return 'vector'
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

interface RawIndex {
  table_name: string
  index_name: string
  is_unique: boolean
  column_name: string
}

/**
 * Secondary indexes actually present in the database.
 *
 * Constraint-BACKED indexes are excluded: Postgres creates one automatically for
 * every primary key and unique constraint, and those are already modelled as
 * column properties (`primaryKey` / `unique`). Including them would report an
 * extra index alongside every unique column.
 */
async function introspectIndexes(db: Database): Promise<RawIndex[]> {
  const rows = await sql<RawIndex>`
    SELECT t.relname AS table_name,
           i.relname AS index_name,
           ix.indisunique AS is_unique,
           a.attname AS column_name
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public'
      AND NOT ix.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid)
    ORDER BY t.relname, i.relname, k.ord
  `.execute(db.kysely)
  return rows.rows
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
           column_default, character_maximum_length, numeric_precision,
           numeric_scale, is_identity, is_generated
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
    if (IGNORED_TABLES.has(c.table_name)) continue
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
      ...(c.character_maximum_length ? {length: c.character_maximum_length} : {}),
      // Decimal precision/scale, only for genuinely constrained numeric columns.
      ...(c.data_type === 'numeric' && c.numeric_precision != null
        ? {precision: c.numeric_precision, scale: c.numeric_scale ?? 0}
        : {}),
      // Presence only — Postgres rewrites the expression, so the text can't be
      // compared to the model's. Drift uses this to SKIP such columns, not diff them.
      ...(c.is_generated === 'ALWAYS' ? {generatedAs: GENERATED_UNKNOWN} : {})
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

  // Real secondary indexes (constraint-backed ones excluded — see the query).
  const byIndex = new Map<string, {table: string; unique: boolean; columns: string[]}>()
  for (const r of await introspectIndexes(db)) {
    if (IGNORED_TABLES.has(r.table_name)) continue
    const entry = byIndex.get(r.index_name) ?? {
      table: r.table_name,
      unique: r.is_unique,
      columns: []
    }
    entry.columns.push(r.column_name)
    byIndex.set(r.index_name, entry)
  }
  for (const [name, ix] of byIndex) {
    const t = schema[ix.table]
    if (!t) continue
    if ((t.indexes ?? []).some(existing => existing.name === name)) continue
    t.indexes = [...(t.indexes ?? []), {name, table: ix.table, columns: ix.columns, unique: ix.unique}]
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
  /**
   * Columns/constraints that EXIST on both sides but don't match — a column whose
   * type, nullability, uniqueness or primary-key-ness differs from the models, a
   * foreign key that is missing//retargeted, an index that is absent. Presence
   * drift can't see any of these: a column hand-altered from `text` to `integer`
   * is present under both, so it read as "in sync".
   */
  mismatches: string[]
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
  return {missingTables, extraTables, columns, mismatches: []}
}

/** Whether any drift was detected. */
export function hasDrift(d: SchemaDrift): boolean {
  return (
    d.missingTables.length > 0 ||
    d.extraTables.length > 0 ||
    d.columns.length > 0 ||
    d.mismatches.length > 0
  )
}

/**
 * Attributes of a live column that introspection reproduces FAITHFULLY, and can
 * therefore be compared without false positives. Established by probing Postgres
 * 16 with every type + modifier the IR emits and reading the schema back.
 *
 * Deliberately absent, because introspection cannot recover them: `defaultSql`
 * and `check` (not read), and `generatedAs` (Postgres rewrites the expression, so
 * the text never matches the model's source). A generated column is skipped
 * entirely — its stored type is derived from the expression, not declared.
 */
const COMPARABLE = ['sqlType', 'array', 'nullable', 'unique', 'primaryKey', 'autoIncrement', 'length', 'precision', 'scale'] as const

/** Human-readable value for a column attribute. */
function attr(v: unknown): string {
  if (typeof v === 'boolean') return String(v) // `nullable is false`, not `is none`
  return v === undefined ? 'none' : JSON.stringify(v)
}

/**
 * Compare a live schema against the expected one at FULL fidelity — types,
 * nullability, uniqueness, primary keys, foreign keys and indexes — not just
 * whether names are present.
 *
 * Extra tables are NOT inspected: a shared database legitimately holds other
 * apps' tables. Extra COLUMNS on a known table are likewise only reported, never
 * treated as a mismatch (an out-of-band column doesn't break the models).
 */
export function computeDeepDrift(actual: PhysicalSchema, expected: PhysicalSchema): string[] {
  const liveByTable = new Map(Object.values(actual).map(t => [t.table, t]))
  const out: string[] = []

  for (const want of Object.values(expected)) {
    const live = liveByTable.get(want.table)
    if (!live) continue // a missing table is presence drift, already reported

    const liveCols = new Map(live.columns.map(c => [c.name, c]))
    for (const wc of want.columns) {
      const lc = liveCols.get(wc.name)
      if (!lc) continue // missing column is presence drift
      // A generated column's type is derived, and its expression is rewritten by
      // Postgres — nothing about it can be compared faithfully.
      if (wc.generatedAs || lc.generatedAs) continue
      for (const a of COMPARABLE) {
        const w = (wc as unknown as Record<string, unknown>)[a]
        const l = (lc as unknown as Record<string, unknown>)[a]
        const norm = (v: unknown) => (v === undefined || v === false ? undefined : v)
        if (JSON.stringify(norm(w)) !== JSON.stringify(norm(l))) {
          out.push(
            `${want.table}.${wc.name}: ${a} is ${attr(l)} in the database, models expect ${attr(w)}`
          )
        }
      }
    }

    // Foreign keys round-trip faithfully (including ON DELETE).
    const liveFks = new Map((live.foreignKeys ?? []).map(f => [f.name, f]))
    for (const wf of want.foreignKeys ?? []) {
      const lf = liveFks.get(wf.name)
      if (!lf) {
        out.push(
          `${want.table}: foreign key "${wf.name}" (${wf.column} → ${wf.refTable}.${wf.refColumn}) is missing from the database`
        )
        continue
      }
      if (lf.refTable !== wf.refTable || lf.refColumn !== wf.refColumn) {
        out.push(
          `${want.table}: foreign key "${wf.name}" points at ${lf.refTable}.${lf.refColumn} in the database, models expect ${wf.refTable}.${wf.refColumn}`
        )
      }
      // Postgres reports the DEFAULT rule as `NO ACTION`, while a model that says
      // nothing leaves `onDelete` undefined — the same thing. Without this every
      // plain foreign key reads as drift on a perfectly in-sync database.
      const rule = (v: string | undefined) => (v === undefined || v === 'no action' ? undefined : v)
      if (rule(lf.onDelete) !== rule(wf.onDelete)) {
        out.push(
          `${want.table}: foreign key "${wf.name}" ON DELETE is ${attr(lf.onDelete)} in the database, models expect ${attr(wf.onDelete)}`
        )
      }
    }

    // Indexes, by name; a renamed index shows as one missing (the models' own).
    const liveIdx = new Map((live.indexes ?? []).map(i => [i.name, i]))
    for (const wi of want.indexes ?? []) {
      const li = liveIdx.get(wi.name)
      if (!li) {
        out.push(
          `${want.table}: index "${wi.name}" (${wi.columns.join(', ')}) is missing from the database`
        )
        continue
      }
      if (li.columns.join(',') !== wi.columns.join(',')) {
        out.push(
          `${want.table}: index "${wi.name}" covers (${li.columns.join(', ')}) in the database, models expect (${wi.columns.join(', ')})`
        )
      }
      if (!!li.unique !== !!wi.unique) {
        out.push(
          `${want.table}: index "${wi.name}" is ${li.unique ? 'UNIQUE' : 'non-unique'} in the database, models expect ${wi.unique ? 'UNIQUE' : 'non-unique'}`
        )
      }
    }
  }
  return out.sort()
}

/** Drift between the live DB and the current models (presence level). */
export async function schemaDrift(db: Database = getDatabase()): Promise<SchemaDrift> {
  const expectedSchema = physicalSchemaOf(toIR().entities)
  const actual = await introspect(db)
  const presence = computeDrift(actual, expectedColumns(expectedSchema))
  // Presence tells you a name is there; it can't tell you the column still has
  // the type, nullability or constraints the models expect. Deep-compare too.
  const mismatches = computeDeepDrift(await introspectPhysical(db), expectedSchema)
  return {...presence, mismatches}
}
