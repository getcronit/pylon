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
    const literalDefault = c.defaultSql ?? sqlDefaultLiteral(c.default)
    if (literalDefault != null) parts.push(`DEFAULT ${literalDefault}`)
    if (c.check) parts.push(`CHECK (${c.check})`)
  }
  return parts.join(' ')
}

/**
 * A scalar `default` value rendered as a SQL literal, or `null` when the value
 * must stay app-side (functions, objects, arrays, dates — applied by the ORM on
 * insert, not by the database). Only primitive scalars become DB defaults.
 */
function sqlDefaultLiteral(v: unknown): string | null {
  switch (typeof v) {
    case 'boolean':
      return v ? 'TRUE' : 'FALSE'
    case 'number':
      return Number.isFinite(v) ? String(v) : null
    case 'bigint':
      return String(v)
    case 'string':
      return `'${v.replace(/'/g, "''")}'`
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
