/**
 * ORM → IR contributor. Converts the ORM's runtime model registry into the
 * `entities` slice of a Pylon IR. This is the bridge that lets the GraphQL,
 * migration and client projections read the ORM's persistence + intent without
 * ever re-deriving it from TypeScript types.
 *
 * Note the dependency direction: this module depends on `@getcronit/pylon-ir`,
 * never the reverse. The IR package has no knowledge of the ORM.
 */
import type {
  ColumnSpec,
  Entity,
  Field,
  PylonIR,
  ScalarName,
  TypeRef
} from '@getcronit/pylon-ir'
import {emptyIR} from '@getcronit/pylon-ir'
import type {
  ColumnDefinition,
  ModelDefinition,
  RelationDefinition,
  SqlType
} from './registry.js'
import {allModels} from './registry.js'

/**
 * Map a SQL column to a GraphQL scalar. The ORM knows precise intent the raw
 * type-checker cannot — a primary key is an `ID`, an integer is an `Int`, a
 * numeric is a `Float` — so the IR carries that intent instead of collapsing
 * everything `number`-shaped to one scalar.
 */
function scalarForColumn(col: ColumnDefinition): ScalarName {
  if (col.primaryKey) return 'ID'
  return scalarForSqlType(col.sqlType)
}

function scalarForSqlType(t: SqlType): ScalarName {
  switch (t) {
    case 'text':
    case 'varchar':
    case 'uuid':
      return 'String'
    case 'integer':
    case 'bigint':
      return 'Int'
    case 'numeric':
      return 'Float'
    case 'boolean':
      return 'Boolean'
    case 'timestamptz':
    case 'date':
      return 'Date'
    case 'jsonb':
      return 'JSON'
  }
}

function columnSpec(col: ColumnDefinition): ColumnSpec {
  return {
    name: col.columnName,
    sqlType: col.sqlType,
    primaryKey: col.primaryKey,
    autoIncrement: col.autoIncrement,
    unique: col.unique,
    nullable: col.nullable,
    length: col.length,
    default: col.default,
    defaultSql: col.defaultSql,
    check: col.check,
    serialize: col.sqlType === 'jsonb' ? 'json' : undefined
  }
}

/** API-facing field name: strip the `$` hide-sigil (visibility is in `exposed`). */
function fieldName(propertyKey: string): string {
  return propertyKey.startsWith('$') ? propertyKey.slice(1) : propertyKey
}

function columnField(col: ColumnDefinition): Field {
  const type: TypeRef = {
    kind: 'scalar',
    name: scalarForColumn(col),
    nullable: col.nullable
  }
  return {
    name: fieldName(col.propertyKey),
    type,
    exposed: !col.hidden,
    column: columnSpec(col)
  }
}

function relationField(rel: RelationDefinition): Field {
  const target = rel.target().name
  if (rel.kind === 'hasMany') {
    return {
      name: rel.propertyKey,
      type: {
        kind: 'list',
        of: {kind: 'ref', name: target, nullable: false},
        nullable: false
      },
      exposed: true,
      relation: {
        kind: 'hasMany',
        target,
        targetFkField: rel.targetForeignKey
      }
    }
  }
  return {
    name: rel.propertyKey,
    type: {kind: 'ref', name: target, nullable: rel.nullable},
    exposed: true,
    relation: {
      kind: 'belongsTo',
      target,
      fkField: rel.fkProperty,
      onDelete: rel.onDelete
    }
  }
}

/** Convert one model definition into an IR `Entity`. */
export function entityFromDefinition(def: ModelDefinition): Entity {
  // Single-column secondary indexes from `{index: true}` field options. (Unique
  // is a column-level constraint, handled separately; composite indexes are a
  // future model-level API — the IR/migration engine already supports them.)
  const indexes = def.columns
    .filter(col => col.index)
    .map(col => ({
      name: `${def.tableName}_${col.columnName}_idx`,
      table: def.tableName,
      columns: [col.columnName],
      unique: false
    }))

  return {
    name: def.ctor.name,
    table: def.tableName,
    abstract: def.abstract,
    primaryKey: def.primaryKey?.propertyKey,
    // `implements` is a type-hierarchy fact the type-checker contributor adds
    // (e.g. `IModel` from the shared `Model` base); the registry doesn't track it.
    implements: [],
    fields: [
      ...def.columns.map(columnField),
      ...def.relations.map(relationField)
    ],
    ...(indexes.length ? {indexes} : {})
  }
}

/**
 * Build the `entities` slice of a Pylon IR from the ORM registry. Defaults to
 * every registered (concrete) model. Returns a full `PylonIR` so it can be
 * `mergeIR`'d with the type-checker's base IR.
 */
export function toIR(defs: ModelDefinition[] = allModels()): PylonIR {
  const ir = emptyIR()
  for (const def of defs) {
    ir.entities[def.ctor.name] = entityFromDefinition(def)
  }
  return ir
}
