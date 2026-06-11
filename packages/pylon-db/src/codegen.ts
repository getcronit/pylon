/**
 * Model-source generation from a `PhysicalSchema` — the codegen half of
 * `pylon db baseline`. Given a schema reconstructed by `introspectPhysical`, emit
 * editable `@model()` class stubs so an existing database can be adopted without
 * hand-transcribing every table. The output is a STARTING POINT a human reviews:
 * defaults, CHECK constraints, non-unique indexes and many-to-many relations are
 * noted but not reconstructed (the FK columns are, as `foreignKey(() => …)`).
 */
import type {
  ForeignKeyChange,
  PhysicalSchema,
  PhysicalTable,
  TableColumn
} from '@getcronit/pylon-ir'

/** `ip_author` → `IpAuthor`. */
function pascal(table: string): string {
  return table
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

/** `author_id` → `authorId`. */
function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

function optsLiteral(parts: Record<string, unknown>): string {
  const entries = Object.entries(parts).filter(
    ([, v]) => v !== undefined && v !== false
  )
  if (!entries.length) return ''
  return `{${entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}}`
}

/** The bare element builder call for an array column (`text`, `int`, …). */
function elementBuilder(sqlType: string): {call: string; used: string} {
  switch (sqlType) {
    case 'integer':
      return {call: 'int()', used: 'int'}
    case 'bigint':
      return {call: 'bigint()', used: 'bigint'}
    case 'numeric':
      return {call: 'numeric()', used: 'numeric'}
    case 'boolean':
      return {call: 'boolean()', used: 'boolean'}
    case 'timestamptz':
      return {call: 'timestamp()', used: 'timestamp'}
    case 'date':
      return {call: 'date()', used: 'date'}
    case 'jsonb':
      return {call: 'json()', used: 'json'}
    case 'uuid':
      return {call: 'uuid()', used: 'uuid'}
    default:
      return {call: 'text()', used: 'text'}
  }
}

/** Render one column as a model field, recording the builders it uses. */
function fieldFor(
  col: TableColumn,
  fk: ForeignKeyChange | undefined,
  used: Set<string>
): string {
  const prop = camel(col.name)

  if (fk) {
    used.add('foreignKey')
    const opts = optsLiteral({
      nullable: col.nullable || undefined,
      onDelete: fk.onDelete && fk.onDelete !== 'no action' ? fk.onDelete : undefined
    })
    const args = opts ? `() => ${pascal(fk.refTable)}, ${opts}` : `() => ${pascal(fk.refTable)}`
    return `  ${prop} = foreignKey(${args})`
  }

  if (col.array) {
    used.add('array')
    const el = elementBuilder(col.sqlType)
    used.add(el.used)
    const opts = optsLiteral({nullable: col.nullable || undefined})
    return `  ${prop} = array(${el.call}${opts ? `, ${opts}` : ''})`
  }

  // Auto-increment bigint PK is the canonical `id()`.
  if (col.primaryKey && col.autoIncrement && col.sqlType === 'bigint') {
    used.add('id')
    return `  ${prop} = id()`
  }

  const common = {
    primaryKey: col.primaryKey || undefined,
    unique: col.unique || undefined,
    nullable: col.nullable || undefined
  }

  switch (col.sqlType) {
    case 'uuid': {
      used.add('uuid')
      return `  ${prop} = uuid(${optsLiteral(common)})`
    }
    case 'varchar': {
      used.add('varchar')
      const opts = optsLiteral(common)
      return `  ${prop} = varchar(${col.length ?? 255}${opts ? `, ${opts}` : ''})`
    }
    case 'integer':
      used.add('int')
      return `  ${prop} = int(${optsLiteral(common)})`
    case 'bigint':
      used.add('bigint')
      return `  ${prop} = bigint(${optsLiteral(common)})`
    case 'numeric':
      used.add('numeric')
      return `  ${prop} = numeric(${optsLiteral(common)})`
    case 'boolean':
      used.add('boolean')
      return `  ${prop} = boolean(${optsLiteral(common)})`
    case 'timestamptz':
      used.add('timestamp')
      return `  ${prop} = timestamp(${optsLiteral(common)})`
    case 'date':
      used.add('date')
      return `  ${prop} = date(${optsLiteral(common)})`
    case 'jsonb':
      used.add('json')
      return `  ${prop} = json(${optsLiteral(common)})`
    default:
      used.add('text')
      return `  ${prop} = text(${optsLiteral(common)})`
  }
}

function classFor(table: PhysicalTable, used: Set<string>): string {
  used.add('model')
  used.add('Model')
  used.add('manager')
  const cls = pascal(table.table)
  const fkByColumn = new Map<string, ForeignKeyChange>()
  for (const fk of table.foreignKeys ?? []) fkByColumn.set(fk.column, fk)

  const hasPk = table.columns.some(c => c.primaryKey)
  const fields = table.columns
    .map(c => fieldFor(c, fkByColumn.get(c.name), used))
    .join('\n')

  const indexNote =
    table.indexes && table.indexes.length
      ? `  // Review: ${table.indexes.length} unique constraint(s)/index(es) — add via @model({indexes: [...]}).\n`
      : ''
  const pkNote = hasPk
    ? ''
    : `  // Review: no single-column primary key detected (composite PK or join table?).\n`

  return (
    `@model({table: ${JSON.stringify(table.table)}})\n` +
    `export class ${cls} extends Model {\n` +
    `  static objects = manager(${cls})\n` +
    pkNote +
    indexNote +
    `${fields}\n` +
    `}`
  )
}

/**
 * Generate TypeScript model source for an introspected schema. Tables are
 * emitted in name order; the import line lists exactly the builders used.
 */
export function generateModelSource(schema: PhysicalSchema): string {
  const used = new Set<string>()
  const tables = Object.values(schema).sort((a, b) => a.table.localeCompare(b.table))
  const classes = tables.map(t => classFor(t, used)).join('\n\n')

  // Stable import order: core first, then field builders alphabetically.
  const core = ['Model', 'model', 'manager'].filter(n => used.has(n))
  const builders = [...used]
    .filter(n => !core.includes(n))
    .sort()
  const imports = [...core, ...builders]

  return (
    `// AUTO-GENERATED by \`pylon db baseline\` — review before committing.\n` +
    `// FK columns are reconstructed; defaults, CHECKs, indexes and m2m relations\n` +
    `// are noted but need manual attention.\n` +
    `import {${imports.join(', ')}} from '@getcronit/pylon-db'\n\n` +
    `${classes}\n`
  )
}
