/**
 * ORM → IR contributor. Converts the ORM's runtime model registry into the
 * `entities` slice of a Pylon IR. This is the bridge that lets the GraphQL,
 * migration and client projections read the ORM's persistence + intent without
 * ever re-deriving it from TypeScript types.
 *
 * Note the dependency direction: this module depends on `@getcronit/pylon/ir`,
 * never the reverse. The IR package has no knowledge of the ORM.
 */
import type {
  ColumnSpec,
  Entity,
  Field,
  PylonIR,
  ScalarName,
  TypeRef
} from '../ir'
import {emptyIR, pgIdent} from '../ir'
import type {
  ColumnDefinition,
  ModelDefinition,
  RelationDefinition,
  SqlType
} from './registry.js'
import {allModels, nodeEnabledFor, resolveColumnSqlType} from './registry.js'
import {snakeCase} from './util.js'

/**
 * Map a SQL column to a GraphQL scalar. The ORM knows precise intent the raw
 * type-checker cannot — a primary key is an `ID`, an integer is an `Int`, a
 * numeric is a `Float` — so the IR carries that intent instead of collapsing
 * everything `number`-shaped to one scalar.
 */
function scalarForColumn(col: ColumnDefinition, isForeignKey = false): ScalarName {
  // A primary key IS an id; a foreign key REFERENCES one — both surface as `ID`
  // so the `ID` scalar's gid-decode covers them on input (a client hands back the
  // gid it was given for a relation). Output is unchanged: `ID` serializes as the
  // plain id string, and only the dedicated `id` field resolver emits a gid, so a
  // FK field still serializes as its raw local id.
  if (col.primaryKey || isForeignKey) return 'ID'
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
    case 'vector':
      // Embedding infrastructure; write-mostly and excluded from the default
      // SELECT (see selectableColumns), but the field still needs a well-formed
      // scalar name. A `number[]` is JSON-shaped.
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
    precision: col.precision,
    scale: col.scale,
    dim: col.dim,
    default: col.default,
    defaultSql: col.defaultSql,
    check: col.check,
    serialize: col.sqlType === 'jsonb' ? 'json' : undefined,
    array: col.array,
    generatedAs: col.generatedAs,
    requires: col.requires,
    enum: col.enumValues?.length ? true : undefined,
    // `models.Struct<T>`: keep the parser's structured object type on the wire instead of
    // collapsing this jsonb column to the `JSON` scalar (see mergeFields). Storage is unchanged.
    struct: col.struct ? true : undefined
  }
}

/** API-facing field name: strip the `$` hide-sigil (visibility is in `exposed`). */
function fieldName(propertyKey: string): string {
  return propertyKey.startsWith('$') ? propertyKey.slice(1) : propertyKey
}

function columnField(col: ColumnDefinition, isForeignKey = false): Field {
  // Enum columns emit a `String` placeholder; the type-checker contributes the
  // real GraphQL enum (with its name), and `mergeFields` keeps that type because
  // the column is flagged `enum` (see columnSpec).
  const scalar: TypeRef = {
    kind: 'scalar',
    name: scalarForColumn(col, isForeignKey),
    nullable: false
  }
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

/** pgvector distance metric → operator class (for `USING hnsw (col <ops>)`). */
const VECTOR_OPS: Record<'cosine' | 'l2' | 'ip', string> = {
  cosine: 'vector_cosine_ops',
  l2: 'vector_l2_ops',
  ip: 'vector_ip_ops'
}

/** Convert one model definition into an IR `Entity`. */
export function entityFromDefinition(def: ModelDefinition): Entity {
  // FK columns (those backing a belongsTo) surface as `ID` so gid input decodes.
  const fkColumnNames = new Set(
    def.relations.map(rel => rel.fkColumn).filter((c): c is string => !!c)
  )
  // Single-column secondary indexes from `{index: true}` field options.
  // Resolve an index property to its column name. Falls back to `snakeCase(prop)` — pylon's
  // default column naming — not the raw property, so an index over a column not in `def.columns`
  // (e.g. an STI subtype's own multi-word column, resolved before the fold) still snake-cases
  // correctly (`emailUid` → `email_uid`) instead of leaking the camelCase property into the DDL.
  const columnFor = (prop: string) =>
    def.columns.find(c => c.propertyKey === prop)?.columnName ?? snakeCase(prop)
  const singleColumn = def.columns
    .filter(col => col.index)
    .map(col => {
      const opts = col.indexOptions ?? {}
      const isVector = col.sqlType === 'vector'
      // A `vector` column defaults to HNSW (btree is unsupported on the type);
      // everything else defaults to btree. `{index: {method, metric, with}}` tunes it.
      const method = opts.method ?? (isVector ? 'hnsw' : undefined)
      const isAnn = method === 'hnsw' || method === 'ivfflat'
      if (isAnn && !isVector) {
        throw new Error(
          `${def.tableName}.${col.propertyKey}: '${method}' index is only valid on a vector column.`
        )
      }
      const ops = isAnn ? VECTOR_OPS[opts.metric ?? 'cosine'] : undefined
      const suffix = isAnn ? method : 'idx'
      return {
        name: pgIdent(`${def.tableName}_${col.columnName}_${suffix}`),
        table: def.tableName,
        columns: [col.columnName],
        unique: false,
        ...(method ? {method} : {}),
        ...(ops ? {ops} : {}),
        ...(opts.with ? {with: opts.with} : {})
      }
    })
  // Composite (multi-column) indexes from the model-level `indexes` option.
  const composite = (def.indexes ?? []).map(ix => {
    const cols = ix.columns.map(columnFor)
    // ANN methods resolve their distance metric to a pgvector operator class.
    const isAnn = ix.method === 'hnsw' || ix.method === 'ivfflat'
    const ops = isAnn ? VECTOR_OPS[ix.metric ?? 'cosine'] : undefined
    return {
      name: ix.name ?? pgIdent(`${def.tableName}_${cols.join('_')}_idx`),
      table: def.tableName,
      columns: cols,
      unique: ix.unique ?? false,
      ...(ix.method ? {method: ix.method} : {}),
      ...(ops ? {ops} : {}),
      ...(ix.with ? {with: ix.with} : {})
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
  // Trigram (`static config {trigram}`) columns get a `gin_trgm_ops` GIN index so a
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
      // before projecting — the stored type is a `bigint` fallback. A FK column
      // (backs a belongsTo relation) surfaces as `ID` so gid input decodes.
      ...def.columns.map(col =>
        columnField(
          {...col, sqlType: resolveColumnSqlType(def, col)},
          fkColumnNames.has(col.columnName)
        )
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

/** Is `sub` a subclass of `base` somewhere up its prototype chain? */
function isPrototypeDescendant(sub: Function, base: Function): boolean {
  let proto = Object.getPrototypeOf(sub)
  while (proto && proto !== Function.prototype) {
    if (proto === base) return true
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

/**
 * Single-table inheritance. For each STI base (a model with `inheritance`), fold
 * its subclasses (models with `discriminatorValue` extending it) into ONE table:
 *
 *  - the base projects to `interface <ClassName>` (its shared exposed fields) —
 *    NOT a concrete `type` (its object type is suppressed by hiding every field);
 *  - the base entity OWNS the shared physical table, unioning every subclass's
 *    columns onto it (forced nullable, hidden from the API);
 *  - each subclass keeps its own object type, `implements` the base interface,
 *    and points at the shared table.
 *
 * The base entity stays in `ir.entities` (it carries the merged table for
 * migrations) but emits no SDL `type` — only the interface + the subclass types
 * are rendered.
 */
function applySingleTableInheritance(ir: PylonIR, defs: ModelDefinition[]): void {
  for (const base of defs.filter(d => d.inheritance)) {
    const baseName = base.ctor.name
    const baseEntity = ir.entities[baseName]
    if (!baseEntity) continue

    const subDefs = defs.filter(
      d =>
        d.discriminatorValue !== undefined &&
        d.ctor !== base.ctor &&
        isPrototypeDescendant(d.ctor, base.ctor)
    )

    // Validate: each subclass's discriminatorValue must be a member of the base
    // discriminator column's enum (when it is one), and unique across the group.
    const discCol = base.columns.find(
      c => c.propertyKey === base.inheritance!.discriminator
    )
    const seen = new Map<string, string>()
    for (const sub of subDefs) {
      const v = String(sub.discriminatorValue)
      if (discCol?.enumValues && !discCol.enumValues.includes(v)) {
        throw new Error(
          `[pylon-db] STI "${baseName}": discriminatorValue "${v}" on "${sub.ctor.name}" ` +
            `is not a value of "${base.inheritance!.discriminator}" ` +
            `(${discCol.enumValues.join(', ')}).`
        )
      }
      const dup = seen.get(v)
      if (dup) {
        throw new Error(
          `[pylon-db] STI "${baseName}": duplicate discriminatorValue "${v}" on ` +
            `"${sub.ctor.name}" and "${dup}".`
        )
      }
      seen.set(v, sub.ctor.name)
    }

    // 1. The interface = the base's own EXPOSED fields (the shared contract),
    //    captured before we suppress the base's object type in step 3.
    ir.interfaces[baseName] = {
      name: baseName,
      fields: baseEntity.fields.filter(f => f.exposed).map(f => ({...f})),
      implements: baseEntity.implements.length ? [...baseEntity.implements] : undefined
    }

    // 2. Union every subclass column onto the base's physical table (nullable +
    //    hidden). Subclasses share the base table and implement the interface.
    const tableCols = new Set(
      baseEntity.fields.filter(f => f.column).map(f => f.column!.name)
    )
    for (const sub of subDefs) {
      const subEntity = ir.entities[sub.ctor.name]
      if (!subEntity) continue
      subEntity.table = base.tableName
      subEntity.sharedTable = true // the base entity owns the physical table
      subEntity.implements = [...subEntity.implements, baseName]
      for (const f of subEntity.fields) {
        if (f.column && !tableCols.has(f.column.name)) {
          tableCols.add(f.column.name)
          baseEntity.fields.push({
            ...f,
            exposed: false,
            type: {...f.type, nullable: true},
            column: {...f.column, nullable: true}
          })
        }
      }
    }

    // 3. Suppress the base's `type <ClassName>` — hide every field, so `toSDL`
    //    skips it. The base entity now only owns the merged table (all columns
    //    still carry `column`, so `tableSpecOf` keeps them) + the interface.
    baseEntity.fields = baseEntity.fields.map(f => ({...f, exposed: false}))
  }
}

/** GraphQL-native `ID!`. */
const ID_NON_NULL = {kind: 'scalar', name: 'ID', nullable: false} as const
/** A whole `gid://…` (type-carrying), the input to `node`. Distinct from `ID`,
 *  which is stripped to a raw local id on input — `node` dispatches on the type. */
const GID_NON_NULL = {kind: 'scalar', name: 'GID', nullable: false} as const

/**
 * Opt-in Relay-style global-object-identity layer. Adds an `interface Node { id:
 * ID! }`, makes every entity/interface that exposes an `id` field implement it
 * (normalizing that `id` to `ID!` so the SDL is valid even for text/cuid PKs),
 * and adds a root `node(id: GID!): Node` refetch field (`GID` = a whole
 * type-carrying gid, unlike `ID` which is stripped to a local id on input). The
 * wire `id` is gid-encoded on output and decoded by the `node` resolver. The
 * type dispatch is by `__typename`, handled by the universal `__resolveType` the
 * builder already attaches to every SDL interface.
 */
function applyNodeInterface(ir: PylonIR, nodeNames: Set<string>): void {
  const NODE = 'Node'
  const exposedId = (fields: {name: string; exposed: boolean; type: unknown}[]) =>
    fields.find(f => f.name === 'id' && f.exposed)

  ir.interfaces[NODE] = {
    name: NODE,
    description: 'An object with a globally-unique id, refetchable via `node`.',
    fields: [
      {
        name: 'id',
        type: {...ID_NON_NULL},
        exposed: true,
        description: 'A globally-unique, opaque object identifier (`gid://…`).'
      }
    ]
  }

  const wireUpNode = (
    holder: {implements?: string[]; fields: {name: string; exposed: boolean; type: unknown}[]},
    ensureImplements: (name: string) => void
  ) => {
    const idField = exposedId(holder.fields)
    if (!idField) return
    idField.type = {...ID_NON_NULL}
    ensureImplements(NODE)
  }

  for (const entity of Object.values(ir.entities)) {
    if (!entity.primaryKey) continue // needs a single PK to be looked up by id
    if (!nodeNames.has(entity.name)) continue // per-model opt-in (app / project default)
    wireUpNode(entity, name => {
      if (!entity.implements.includes(name)) entity.implements.push(name)
    })
  }
  // STI base interfaces expose an `id` too — implement Node (only if that base's
  // model opted in) so a subclass's `id: ID!` stays consistent with every interface.
  for (const iface of Object.values(ir.interfaces)) {
    if (iface.name === NODE) continue
    if (!nodeNames.has(iface.name)) continue
    wireUpNode(iface, name => {
      iface.implements = iface.implements ?? []
      if (!iface.implements.includes(name)) iface.implements.push(name)
    })
  }

  if (!ir.scalars.includes('ID')) ir.scalars.push('ID')
  if (!ir.scalars.includes('GID')) ir.scalars.push('GID')
  ir.operations.push({
    root: 'Query',
    name: 'node',
    description: 'Fetch any object by its global id.',
    // `GID`, not `ID`: `node` needs the whole `gid://ns/Type/local` to dispatch on
    // the type — the `ID` scalar would strip it to a bare local id first.
    args: [{name: 'id', type: {...GID_NON_NULL}, exposed: true}],
    returns: {kind: 'ref', name: NODE, nullable: true}
  })
}

/**
 * Build the `entities` slice of a Pylon IR from the ORM registry. Defaults to
 * every registered (concrete) model. Returns a full `PylonIR` so it can be
 * `mergeIR`'d with the type-checker's base IR.
 *
 * `options.node` opts into the Relay `Node` interface + `node(id): Node` refetch
 * field (global-object identity). Off by default — enabling it changes the wire
 * shape of `id` (raw → gid).
 */
export function toIR(
  defs: ModelDefinition[] = allModels(),
  options: {node?: boolean} = {}
): PylonIR {
  const ir = emptyIR()
  for (const def of defs) {
    ir.entities[def.ctor.name] = entityFromDefinition(def)
  }
  applySingleTableInheritance(ir, defs)
  // Which entities expose global ids. An explicit `options.node` forces all/none
  // (a test / whole-schema override); otherwise resolve PER MODEL — the model's own
  // `node` (app-level / `static config`) or the project default. The `Node`
  // interface + `node()` field are added iff at least one entity opts in.
  const nodeNames = new Set(
    defs
      .filter(def => (options.node === undefined ? nodeEnabledFor(def) : options.node))
      .map(def => def.ctor.name)
  )
  if (nodeNames.size) applyNodeInterface(ir, nodeNames)
  return ir
}
