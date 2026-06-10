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
import {physicalSchemaOf, type PhysicalSchema} from '@getcronit/pylon-ir'
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
