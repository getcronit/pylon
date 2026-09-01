/**
 * SQL projection: an entity's IR → a `CREATE TABLE` statement. Pure function of
 * the IR; reads only fields that carry a `column`. The exact same `Entity`
 * object the GraphQL projection renders is what produces the table here.
 *
 * Foreign keys are deliberately NOT emitted inline: the migration engine
 * (`diff.ts`) resolves them into self-contained `addForeignKey` changes so a
 * stored migration can reference tables outside its own change-set. A bare
 * `CREATE TABLE` here is always columns-only.
 */
import type {ColumnSpec, TableSpec} from './ir.js'
import {postgres} from './dialect.js'

/** The `"name" type CONSTRAINTS` fragment for a column, reused by CREATE/ADD. */
export function columnDDL(c: ColumnSpec): string {
  const parts = [`"${c.name}"`]
  if (c.primaryKey && c.autoIncrement) {
    parts.push(postgres.autoIncrementPrimaryKey())
  } else if (c.generatedAs) {
    // A stored generated column (e.g. a tsvector derived from text columns).
    parts.push(sqlTypeDDL(c), postgres.generatedColumn(c.generatedAs))
  } else {
    parts.push(sqlTypeDDL(c))
    if (c.primaryKey) parts.push('PRIMARY KEY')
    if (c.unique) parts.push('UNIQUE')
    if (!c.nullable && !c.primaryKey) parts.push('NOT NULL')
    // A DB-level DEFAULT: an explicit `defaultSql` wins; otherwise a *scalar*
    // `default` value is serialized to a literal. This is what backfills existing
    // rows when a NOT NULL column is added to a populated table (`ADD COLUMN …
    // NOT NULL` with no default → a NOT NULL violation). Non-scalar defaults
    // (functions like `createId`/`now()`, objects, arrays, dates) stay app-side —
    // the ORM applies them on insert — so they're skipped here.
    const literalDefault = c.defaultSql ?? sqlDefaultLiteral(c.default, c)
    if (literalDefault != null) parts.push(`DEFAULT ${literalDefault}`)
    if (c.check) parts.push(`CHECK (${c.check})`)
  }
  return parts.join(' ')
}

/** A SQL string literal (single quotes doubled). */
function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * A JS array default (`[]`, `['a','b']`) → a Postgres array literal (`'{}'`,
 * `'{"a","b"}'`). Each element is double-quoted + escaped, which Postgres accepts
 * for text[] and numeric[] alike; empty is the common case.
 */
function pgArrayLiteral(arr: readonly unknown[]): string {
  const body = arr
    .map(v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
  return quote(`{${body}}`)
}

/**
 * A `default` value rendered as a SQL literal, or `null` when it can only be
 * applied app-side (a function like `createId`, a Date, anything else the
 * database can't hold as a constant).
 *
 * This is what BACKFILLS existing rows when a NOT NULL column is added to a
 * populated table. Returning null there means `ADD COLUMN … NOT NULL` runs with
 * no DEFAULT and Postgres rejects it with "column contains null values", so the
 * set of values handled here is load-bearing, not cosmetic:
 *
 *   - object/array on a `jsonb` column → `'{"a":1}'::jsonb`. Previously null, so
 *     `default: {}` — the ordinary way to give a jsonb column an empty default —
 *     silently produced a NOT NULL column with nothing to backfill with.
 *   - array on an array column → a Postgres array literal. `db push` already did
 *     this while migrations did not, so the two disagreed about the same model.
 */
export function sqlDefaultLiteral(v: unknown, col?: Pick<ColumnSpec, 'sqlType' | 'array'>): string | null {
  if (v === undefined || v === null) return null
  // Array COLUMN (`text[]`): a JS array is the element list.
  if (col?.array && Array.isArray(v)) {
    return col.sqlType === 'jsonb'
      ? pgArrayLiteral(v.map(el => JSON.stringify(el)))
      : pgArrayLiteral(v)
  }
  // jsonb COLUMN: an object or array is the document itself.
  if (col?.sqlType === 'jsonb' && typeof v === 'object') {
    return `${quote(JSON.stringify(v))}::jsonb`
  }
  switch (typeof v) {
    case 'boolean':
      return v ? 'TRUE' : 'FALSE'
    case 'number':
      return Number.isFinite(v) ? String(v) : null
    case 'bigint':
      return String(v)
    case 'string':
      return quote(v)
    default:
      return null
  }
}

/** The bare SQL type (varchar length / numeric precision+scale; `[]` for arrays). */
export function sqlTypeDDL(c: ColumnSpec): string {
  return postgres.columnType(c)
}

/** Project a table spec to a columns-only `CREATE TABLE` statement. */
export function toDDL(spec: TableSpec): string {
  const lines = spec.columns.map(c => `  ${columnDDL(c)}`).join(',\n')
  return `CREATE TABLE "${spec.table}" (\n${lines}\n)`
}
