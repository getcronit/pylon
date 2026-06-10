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

/** The `"name" type CONSTRAINTS` fragment for a column, reused by CREATE/ADD. */
export function columnDDL(c: ColumnSpec): string {
  const parts = [`"${c.name}"`]
  if (c.primaryKey && c.autoIncrement) {
    parts.push('bigint', 'PRIMARY KEY', 'GENERATED ALWAYS AS IDENTITY')
  } else {
    parts.push(sqlTypeDDL(c))
    if (c.primaryKey) parts.push('PRIMARY KEY')
    if (c.unique) parts.push('UNIQUE')
    if (!c.nullable && !c.primaryKey) parts.push('NOT NULL')
    if (c.defaultSql) parts.push(`DEFAULT ${c.defaultSql}`)
    if (c.check) parts.push(`CHECK (${c.check})`)
  }
  return parts.join(' ')
}

/** The bare SQL type (with length for varchar). */
export function sqlTypeDDL(c: ColumnSpec): string {
  if (c.sqlType === 'varchar' && c.length) return `varchar(${c.length})`
  return c.sqlType
}

/** Project a table spec to a columns-only `CREATE TABLE` statement. */
export function toDDL(spec: TableSpec): string {
  const lines = spec.columns.map(c => `  ${columnDDL(c)}`).join(',\n')
  return `CREATE TABLE "${spec.table}" (\n${lines}\n)`
}
