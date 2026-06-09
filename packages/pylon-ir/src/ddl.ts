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
import type {ColumnSpec, Entity} from './ir.js'

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
  }
  return parts.join(' ')
}

/** The bare SQL type (with length for varchar). */
export function sqlTypeDDL(c: ColumnSpec): string {
  if (c.sqlType === 'varchar' && c.length) return `varchar(${c.length})`
  return c.sqlType
}

/** Project a single entity to a columns-only `CREATE TABLE` statement. */
export function toDDL(entity: Entity): string {
  const lines = entity.fields
    .filter(f => f.column)
    .map(f => `  ${columnDDL(f.column!)}`)
    .join(',\n')
  return `CREATE TABLE "${entity.table}" (\n${lines}\n)`
}
