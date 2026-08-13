/**
 * Model-source generation from a `PhysicalSchema` — the codegen half of
 * `pylon db baseline`. Given a schema reconstructed by `introspectPhysical`, emit
 * editable `@model()` class stubs so an existing database can be adopted without
 * hand-transcribing every table. The output is a STARTING POINT a human reviews:
 * defaults, CHECK constraints and non-unique indexes are noted but not
 * reconstructed (FK columns are, as `foreignKey(() => …)`).
 *
 * Implicit many-to-many join tables (two FK columns, no own primary key — the
 * shape Prisma generates for `_AToB`) are DETECTED, omitted as models, and
 * re-expressed as a `manyToMany()` field on each endpoint, bound to the real
 * join table + columns so it works against the existing database.
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

/** `ProductCollection` → `productCollections` (a naive English pluralizer). */
function pluralCamel(className: string): string {
  const c = className.charAt(0).toLowerCase() + className.slice(1)
  if (/[^aeiou]y$/.test(c)) return `${c.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(c)) return `${c}es`
  return `${c}s`
}

/** A `manyToMany` field to inject on an endpoint model of a join table. */
interface M2MInjection {
  /** The endpoint table this field lives on. */
  ownerTable: string
  /** The table at the other end of the relation. */
  targetTable: string
  /** The real join table name. */
  joinTable: string
  /** Join column referencing the owner. */
  sourceColumn: string
  /** Join column referencing the target. */
  targetColumn: string
}

/**
 * Detect implicit m2m join tables and plan the `manyToMany` fields that replace
 * them. A join table here is a table with exactly two FK columns and no own
 * primary key (Prisma's `_AToB`). Each one is omitted and yields one injected
 * field on each endpoint (two on the same model for a self-relation).
 */
function detectJoinTables(tables: PhysicalTable[]): {
  omit: Set<string>
  byOwner: Map<string, M2MInjection[]>
} {
  const omit = new Set<string>()
  const byOwner = new Map<string, M2MInjection[]>()
  const add = (inj: M2MInjection) => {
    const list = byOwner.get(inj.ownerTable) ?? []
    list.push(inj)
    byOwner.set(inj.ownerTable, list)
  }
  for (const t of tables) {
    const fks = t.foreignKeys ?? []
    const isJoin =
      t.columns.length === 2 &&
      fks.length === 2 &&
      t.columns.every(c => fks.some(f => f.column === c.name)) &&
      !t.columns.some(c => c.primaryKey)
    if (!isJoin) continue
    const [fkA, fkB] = fks
    omit.add(t.table)
    add({
      ownerTable: fkA.refTable,
      targetTable: fkB.refTable,
      joinTable: t.table,
      sourceColumn: fkA.column,
      targetColumn: fkB.column
    })
    add({
      ownerTable: fkB.refTable,
      targetTable: fkA.refTable,
      joinTable: t.table,
      sourceColumn: fkB.column,
      targetColumn: fkA.column
    })
  }
  return {omit, byOwner}
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

/**
 * Assign every table a unique class identifier. Real tables claim their name
 * before `_`-prefixed implicit join tables (Prisma's `_AToB`), so a join table
 * colliding with a real one (`_ProductNotice` vs `ProductNotice`) is the side
 * that gets disambiguated — keeping the domain model's name clean.
 */
function classNameMap(tables: PhysicalTable[]): Map<string, string> {
  const ordered = [...tables].sort((a, b) => {
    const au = a.table.startsWith('_') ? 1 : 0
    const bu = b.table.startsWith('_') ? 1 : 0
    return au - bu || a.table.localeCompare(b.table)
  })
  const used = new Set<string>()
  const map = new Map<string, string>()
  for (const t of ordered) {
    const base = pascal(t.table)
    let name = base
    for (let i = 2; used.has(name); i++) name = `${base}${i}`
    used.add(name)
    map.set(t.table, name)
  }
  return map
}

/** Render one column as a model field, recording the builders it uses. */
function fieldFor(
  col: TableColumn,
  fk: ForeignKeyChange | undefined,
  used: Set<string>,
  names: Map<string, string>
): string {
  const prop = camel(col.name)

  if (fk) {
    used.add('foreignKey')
    const target = names.get(fk.refTable) ?? pascal(fk.refTable)
    const opts = optsLiteral({
      nullable: col.nullable || undefined,
      onDelete: fk.onDelete && fk.onDelete !== 'no action' ? fk.onDelete : undefined
    })
    const args = opts ? `() => ${target}, ${opts}` : `() => ${target}`
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
      return `  ${prop} = numeric(${optsLiteral({
        ...common,
        precision: col.precision,
        scale: col.scale
      })})`
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

/** Render the injected `manyToMany` fields for one model (unique prop names). */
function m2mFieldsFor(
  injections: M2MInjection[],
  used: Set<string>,
  names: Map<string, string>,
  taken: Set<string>
): string {
  if (!injections.length) return ''
  used.add('manyToMany')
  return injections
    .map(inj => {
      const targetClass = names.get(inj.targetTable) ?? pascal(inj.targetTable)
      const base = pluralCamel(targetClass)
      let prop = base
      for (let i = 2; taken.has(prop); i++) prop = `${base}${i}`
      taken.add(prop)
      const opts = `{through: ${JSON.stringify(inj.joinTable)}, sourceColumn: ${JSON.stringify(inj.sourceColumn)}, targetColumn: ${JSON.stringify(inj.targetColumn)}}`
      return `  // Review: m2m via join table ${inj.joinTable} — rename as desired.\n  ${prop} = manyToMany(() => ${targetClass}, ${opts})`
    })
    .join('\n')
}

function classFor(
  table: PhysicalTable,
  used: Set<string>,
  names: Map<string, string>,
  m2m: M2MInjection[]
): string {
  used.add('model')
  used.add('Model')
  used.add('manager')
  const cls = names.get(table.table) ?? pascal(table.table)
  const fkByColumn = new Map<string, ForeignKeyChange>()
  for (const fk of table.foreignKeys ?? []) fkByColumn.set(fk.column, fk)

  const hasPk = table.columns.some(c => c.primaryKey)
  const taken = new Set(table.columns.map(c => camel(c.name)))
  const fields = table.columns
    .map(c => fieldFor(c, fkByColumn.get(c.name), used, names))
    .join('\n')
  const m2mFields = m2mFieldsFor(m2m, used, names, taken)

  const indexNote =
    table.indexes && table.indexes.length
      ? `  // Review: ${table.indexes.length} unique constraint(s)/index(es) — add via @model({indexes: [...]}).\n`
      : ''
  const pkNote = hasPk
    ? ''
    : `  // Review: no single-column primary key detected (composite PK?).\n`

  return (
    `@model({table: ${JSON.stringify(table.table)}})\n` +
    `export class ${cls} extends Model {\n` +
    `  static objects = manager(${cls})\n` +
    pkNote +
    indexNote +
    `${fields}\n` +
    (m2mFields ? `${m2mFields}\n` : '') +
    `}`
  )
}

/**
 * Generate TypeScript model source for an introspected schema. Tables are
 * emitted in name order; the import line lists exactly the builders used.
 */
export function generateModelSource(schema: PhysicalSchema): string {
  const used = new Set<string>()
  const all = Object.values(schema)
  const {omit, byOwner} = detectJoinTables(all)
  const tables = all
    .filter(t => !omit.has(t.table))
    .sort((a, b) => a.table.localeCompare(b.table))
  const names = classNameMap(tables)
  const classes = tables
    .map(t => classFor(t, used, names, byOwner.get(t.table) ?? []))
    .join('\n\n')

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
