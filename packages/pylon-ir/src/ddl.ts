/**
 * SQL projection: an entity's IR → a `CREATE TABLE` statement. Pure function of
 * the IR; reads only fields that carry a `column`. The exact same `Entity`
 * object the GraphQL projection renders is what produces the table here.
 */
import type {ColumnSpec, Entity, Field} from './ir.js'

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

function foreignKeyDDL(f: Field, entity: Entity, lookup: (name: string) => Entity | undefined): string | null {
  const rel = f.relation
  if (!rel || rel.kind !== 'belongsTo' || !rel.fkField) return null
  const fkCol = entity.fields.find(c => c.name === rel.fkField)?.column?.name
  const target = lookup(rel.target)
  const targetPk = target?.fields.find(c => c.name === target.primaryKey)?.column?.name
  if (!fkCol || !target || !targetPk) return null
  const onDelete = rel.onDelete ? ` ON DELETE ${rel.onDelete.toUpperCase()}` : ''
  return `FOREIGN KEY ("${fkCol}") REFERENCES "${target.table}" ("${targetPk}")${onDelete}`
}

/** Project a single entity to a `CREATE TABLE` statement. */
export function toDDL(
  entity: Entity,
  lookup: (name: string) => Entity | undefined = () => undefined
): string {
  const columns = entity.fields
    .filter(f => f.column)
    .map(f => columnDDL(f.column!))
  const fks = entity.fields
    .map(f => foreignKeyDDL(f, entity, lookup))
    .filter((s): s is string => s !== null)
  const lines = [...columns, ...fks].map(l => `  ${l}`).join(',\n')
  return `CREATE TABLE "${entity.table}" (\n${lines}\n)`
}
