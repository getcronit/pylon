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
import {emptyIR, pgIdent} from '@getcronit/pylon-ir'
import type {
  ColumnDefinition,
  ModelDefinition,
  RelationDefinition,
  SqlType
} from './registry.js'
import {allModels, resolveColumnSqlType} from './registry.js'

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
    case 'tsvector':
      // Search infrastructure; never exposed (the column is hidden), but the
      // field still needs a scalar name to be well-formed.
      return 'String'
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
    precision: col.precision,
    scale: col.scale,
    default: col.default,
    defaultSql: col.defaultSql,
    check: col.check,
    serialize: col.sqlType === 'jsonb' ? 'json' : undefined,
    array: col.array,
    generatedAs: col.generatedAs,
    requires: col.requires,
    enum: col.enumValues?.length ? true : undefined
  }
}

/** API-facing field name: strip the `$` hide-sigil (visibility is in `exposed`). */
function fieldName(propertyKey: string): string {
  return propertyKey.startsWith('$') ? propertyKey.slice(1) : propertyKey
}

function columnField(col: ColumnDefinition): Field {
  // Enum columns emit a `String` placeholder; the type-checker contributes the
  // real GraphQL enum (with its name), and `mergeFields` keeps that type because
  // the column is flagged `enum` (see columnSpec).
  const scalar: TypeRef = {kind: 'scalar', name: scalarForColumn(col), nullable: false}
  // An array column surfaces as a GraphQL list of the element type.
  const type: TypeRef = col.array
    ? {kind: 'list', of: scalar, nullable: col.nullable}
    : {...scalar, nullable: col.nullable}
  return {
    name: fieldName(col.propertyKey),
    type,
    exposed: !col.hidden,
    column: columnSpec(col)
  }
}

function relationField(rel: RelationDefinition, def: ModelDefinition): Field {
  const target = rel.target().name
  if (rel.kind === 'hasMany') {
    return {
      name: fieldName(rel.propertyKey),
      type: {
        kind: 'list',
        of: {kind: 'ref', name: target, nullable: false},
        nullable: false
      },
      exposed: !rel.hidden,
      relation: {
        kind: 'hasMany',
        target,
        targetFkField: rel.targetForeignKey
      }
    }
  }
  if (rel.kind === 'hasOne') {
    // Inverse 1:1 → a single nullable ref (the related row may not exist), like
    // belongsTo but the FK lives on the target side.
    return {
      name: fieldName(rel.propertyKey),
      type: {kind: 'ref', name: target, nullable: true},
      exposed: !rel.hidden,
      relation: {
        kind: 'hasOne',
        target,
        targetFkField: rel.targetForeignKey
      }
    }
  }
  if (rel.kind === 'manyToMany') {
    return {
      name: fieldName(rel.propertyKey),
      type: {
        kind: 'list',
        of: {kind: 'ref', name: target, nullable: false},
        nullable: false
      },
      exposed: !rel.hidden,
      relation: {
        kind: 'manyToMany',
        target,
        through: rel.through,
        sourceColumn: rel.sourceColumn,
        targetColumn: rel.targetColumn,
        inverse: rel.inverse
      }
    }
  }
  // belongsTo: expose the relation only when its FK column is exposed. A `hidden`
  // FK (e.g. an internal back-reference) thus drops BOTH its scalar id AND this
  // relation from the API — which also breaks would-be schema cycles, e.g.
  // Organization.avatar ⇄ VaultItem.avatarOfOrganization.
  const fkHidden = rel.fkProperty
    ? (def.columns.find(c => c.propertyKey === rel.fkProperty)?.hidden ?? false)
    : false
  return {
    name: fieldName(rel.propertyKey),
    type: {kind: 'ref', name: target, nullable: rel.nullable},
    exposed: !fkHidden,
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
  // Single-column secondary indexes from `{index: true}` field options.
  const columnFor = (prop: string) =>
    def.columns.find(c => c.propertyKey === prop)?.columnName ?? prop
  const singleColumn = def.columns
    .filter(col => col.index)
    .map(col => ({
      name: pgIdent(`${def.tableName}_${col.columnName}_idx`),
      table: def.tableName,
      columns: [col.columnName],
      unique: false
    }))
  // Composite (multi-column) indexes from the model-level `indexes` option.
  const composite = (def.indexes ?? []).map(ix => {
    const cols = ix.columns.map(columnFor)
    return {
      name: ix.name ?? pgIdent(`${def.tableName}_${cols.join('_')}_idx`),
      table: def.tableName,
      columns: cols,
      unique: ix.unique ?? false,
      ...(ix.method ? {method: ix.method} : {})
    }
  })
  // Full-text columns get a GIN index automatically (the point of a tsvector).
  const ginIndexes = def.columns
    .filter(col => col.sqlType === 'tsvector')
    .map(col => ({
      name: `${def.tableName}_${col.columnName}_gin`,
      table: def.tableName,
      columns: [col.columnName],
      unique: false,
      method: 'gin' as const
    }))
  // Trigram (`@model({trigram})`) columns get a `gin_trgm_ops` GIN index so a
  // `contains` (`ILIKE '%x%'`) substring filter is index-backed, not a seq scan.
  const trgmIndexes = (def.trigramColumns ?? []).map(colName => ({
    name: `${def.tableName}_${colName}_trgm`,
    table: def.tableName,
    columns: [colName],
    unique: false,
    method: 'gin' as const,
    ops: 'gin_trgm_ops'
  }))
  const indexes = [...singleColumn, ...composite, ...ginIndexes, ...trgmIndexes]

  return {
    name: def.ctor.name,
    table: def.tableName,
    abstract: def.abstract,
    primaryKey: def.primaryKey?.propertyKey,
    // `implements` is a type-hierarchy fact the type-checker contributor adds
    // (e.g. `IModel` from the shared `Model` base); the registry doesn't track it.
    implements: [],
    fields: [
      // Resolve FK column types against their target PK (cuid `text` PKs etc.)
      // before projecting — the stored type is a `bigint` fallback.
      ...def.columns.map(col =>
        columnField({...col, sqlType: resolveColumnSqlType(def, col)})
      ),
      // Paginated relations surface as callable fields (Relay `Connection` +
      // args), which the type-checker reads off the field type and emits — so the
      // ORM must NOT also contribute a plain list field (double-declare).
      //
      // EXCEPTION: a paginated many-to-many still needs its relation metadata in
      // the IR so the migration engine synthesizes the join table (`joinTablesOf`
      // scans m2m relations regardless of `exposed`). Without this, a paginated
      // m2m's join table is missing from the desired schema and `db diff` drops
      // the live table. So keep paginated m2m with `exposed: false` (present for
      // migrations, absent from the GraphQL API); paginated hasMany has no join
      // table and is dropped entirely.
      // hasManyThrough is a pure read accessor — no column, table, or FK — and its
      // Connection field is emitted by the type-checker off the callable return type.
      // Drop it from the IR entirely (both paginated and plain) so it never
      // double-declares nor reaches `relationField` (which has no case for it).
      ...def.relations
        .filter(rel => rel.kind !== 'hasManyThrough')
        .filter(rel => !rel.paginate || rel.kind === 'manyToMany')
        .map(rel =>
          rel.paginate
            ? {...relationField(rel, def), exposed: false}
            : relationField(rel, def)
        )
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
