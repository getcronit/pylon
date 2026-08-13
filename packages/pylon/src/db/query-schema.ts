// The canonical, per-model **Query Schema** — the single source of truth for what
// is filterable/searchable on a model, derived from its column + search metadata.
//
// Both query surfaces project from this one schema (see QUERY_API_DESIGN.md):
//   • Surface B — the Shopify-style `query` string (parseSearchQuery), today.
//   • Surface A — a typed `where` GraphQL input, later (Phase 4).
//
// Phase 1 scope: OWN columns + the model's search set(s). Relations and virtual /
// derived fields land in later phases. A field carries a `visibility` so the same
// schema can serve a lenient internal surface and a strict public one.

import {
  getModelDefinition,
  type ColumnDefinition,
  type ModelDefinition,
  type RelationKind
} from './registry.js'

/** Default number of relation hops a query may traverse. Shopify-ish: shallow. */
export const MAX_RELATION_DEPTH = 1

/** Comparison operators a field accepts (derived from its value type). */
export type QueryOp = 'eq' | 'contains' | 'startsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists'

/** Who may query a field. Public = exposable on the public API; internal = webapp-only. */
export type FieldVisibility = 'public' | 'internal'

/** Whether a query is being parsed for a public consumer (strict) or internally
 *  (lenient — unknown fields are ignored, matching legacy behavior). */
export type QueryScope = 'public' | 'internal'

/** Builds a `WhereInput` fragment for a virtual/derived field from the parsed
 *  operator + raw value. Return `null` (or `{}`) for "no constraint". */
export type QueryFieldToWhere = (op: QueryOp, value: string) => Record<string, unknown> | null

/** A field declared via `static config {query:{fields}}` — either a re-path/alias or a
 *  virtual predicate. Lets a model expose derived/relational filters under a name. */
export type QueryFieldConfig =
  | {path: string; visibility?: FieldVisibility}
  | {toWhere: QueryFieldToWhere; textual?: boolean; ops?: QueryOp[]; visibility?: FieldVisibility}

/** Per-model query configuration (`static config.query`). `T` is the model instance type
 *  (from `satisfies ModelConfig<T>`), so `public` autocompletes the model's own fields
 *  while still accepting virtual/alias names declared in `fields`. */
export interface QueryConfig<T = unknown> {
  /** Extra / overriding query fields keyed by public name. */
  fields?: Record<string, QueryFieldConfig>
  /** Public-surface allowlist. When set, ONLY these names are public (a curated
   *  public API); everything else is internal. When unset, own columns are public
   *  and relations/virtuals are internal. A model field name (autocompleted) or a
   *  virtual/alias name from `fields` (any string). */
  public?: Array<Extract<keyof T, string> | (string & {})>
}

/** One queryable field on a model. `column` is auto-derived; `alias` re-points to
 *  another path; `virtual` carries a custom predicate builder. */
export interface QueryableField {
  /** Public field name used in the query (defaults to the property key). */
  name: string
  kind: 'column' | 'alias' | 'virtual'
  propertyKey: string
  columnName: string
  sqlType: string
  /** Enum members, if the column is an enum (values stay raw — never coerced). */
  enumValues?: readonly string[]
  /** Text-ish column → supports `contains` / `startsWith` (ILIKE). */
  textual: boolean
  ops: QueryOp[]
  visibility: FieldVisibility
  /** kind `alias`: the dotted path this name expands to (resolved from the model). */
  path?: string
  /** kind `virtual`: builds the predicate from (op, value). */
  toWhere?: QueryFieldToWhere
}

/** A relation exposed for nested filtering via a dotted path (`vendor.name:nike`,
 *  `inventoryItems.sku:abc*`). The target's own fields come from its query schema,
 *  built one depth shallower (so traversal is bounded). */
export interface RelationField {
  name: string
  propertyKey: string
  kind: RelationKind
  /** hasMany / manyToMany → the predicate is wrapped in `{some: …}`. */
  toMany: boolean
  visibility: FieldVisibility
  /** The target model's query schema (lazy — bounds cycles, defers resolution). */
  target: () => QuerySchema
}

/** The bare-term search target: FTS, trigram, or the substring fallback. */
export interface SearchTarget {
  /** A `static config {search}` tsvector column → FTS (`@@`). */
  fts?: {propertyKey: string; language: string}
  /** Property keys with a `gin_trgm_ops` index (`static config {trigram}`) → index-backed
   *  substring ILIKE. OR-ed with `fts` for mixed prose+identifier models. */
  trigram?: string[]
  /** Property keys of textual columns for the substring fallback (no FTS/trigram). */
  textColumns: string[]
}

export interface QuerySchema {
  tableName: string
  fields: QueryableField[]
  /** Resolve a field by its public name OR its physical column name. */
  byName: Map<string, QueryableField>
  /** Relation fields for nested paths, keyed by name. Empty at depth 0. */
  relations: Map<string, RelationField>
  search: SearchTarget
}

function isTextualType(sqlType: string): boolean {
  return sqlType === 'text' || sqlType === 'varchar'
}

/** Operators allowed for a column, by value type. */
function opsForColumn(col: ColumnDefinition): QueryOp[] {
  const base: QueryOp[] = ['eq', 'exists']
  if (isTextualType(col.sqlType)) {
    // enum is stored as text but only makes sense as equality membership
    if (col.enumValues?.length) return base
    return [...base, 'contains', 'startsWith']
  }
  if (
    col.sqlType === 'integer' ||
    col.sqlType === 'bigint' ||
    col.sqlType === 'numeric' ||
    col.sqlType === 'date' ||
    col.sqlType === 'timestamptz'
  ) {
    return [...base, 'gt', 'gte', 'lt', 'lte']
  }
  return base // boolean, etc.
}

function build(def: ModelDefinition, depth: number): QuerySchema {
  const fields: QueryableField[] = []
  const byName = new Map<string, QueryableField>()
  let fts: SearchTarget['fts']

  // A `public` allowlist makes the public surface a curated subset: ONLY listed
  // names are public. Without it, columns are public and relations/virtuals are
  // internal (QUERY_API_DESIGN.md §4.3).
  const allow = def.query?.public ? new Set(def.query.public) : undefined
  const vis = (name: string, fallback: FieldVisibility): FieldVisibility =>
    allow ? (allow.has(name) ? 'public' : 'internal') : fallback

  for (const col of def.columns) {
    // A synthesized tsvector is the FTS search target, never a queryable field.
    if (col.sqlType === 'tsvector') {
      if (!fts) fts = {propertyKey: col.propertyKey, language: col.ftsLanguage ?? 'english'}
      continue
    }
    if (col.hidden) continue // never expose hidden columns

    const field: QueryableField = {
      name: col.propertyKey,
      kind: 'column',
      propertyKey: col.propertyKey,
      columnName: col.columnName,
      sqlType: col.sqlType,
      enumValues: col.enumValues,
      textual: isTextualType(col.sqlType),
      ops: opsForColumn(col),
      visibility: vis(col.propertyKey, 'public')
    }
    fields.push(field)
    byName.set(field.name, field)
    // also resolvable by the physical column name (e.g. `body_text:foo`)
    if (field.columnName !== field.name) byName.set(field.columnName, field)
  }

  const textColumns = fields.filter(f => f.textual).map(f => f.propertyKey)

  // Relations → nested-path fields, but only within the remaining depth budget.
  // Each target schema is built one depth shallower (depth-1), which bounds both
  // traversal and cycles (a self-referential relation stops at depth 0 = no rels).
  const relations = new Map<string, RelationField>()
  if (depth > 0) {
    for (const rel of def.relations) {
      // hasManyThrough is a read-only chain accessor — not a filterable path (there's
      // no single reverse FK to correlate on), so it never enters the query schema.
      if (rel.kind === 'hasManyThrough') continue
      const targetDef = getModelDefinition(rel.target())
      if (!targetDef) continue // unresolved target → not traversable
      relations.set(rel.propertyKey, {
        name: rel.propertyKey,
        propertyKey: rel.propertyKey,
        kind: rel.kind,
        toMany: rel.kind === 'hasMany' || rel.kind === 'manyToMany',
        // Relations are internal unless opted into the public surface.
        visibility: vis(rel.propertyKey, 'internal'),
        target: () => buildQuerySchema(targetDef, depth - 1)
      })
    }
  }

  // static config {query:{fields}} — alias/re-path and virtual/derived fields. These
  // override an auto column of the same name (e.g. re-path it through a relation).
  for (const [name, cfg] of Object.entries(def.query?.fields ?? {})) {
    const field: QueryableField =
      'toWhere' in cfg
        ? {
            name,
            kind: 'virtual',
            propertyKey: name,
            columnName: name,
            sqlType: '',
            textual: cfg.textual ?? false,
            ops: cfg.ops ?? ['eq'],
            visibility: vis(name, cfg.visibility ?? 'internal'),
            toWhere: cfg.toWhere
          }
        : {
            name,
            kind: 'alias',
            propertyKey: name,
            columnName: name,
            sqlType: '',
            textual: false,
            ops: [],
            visibility: vis(name, cfg.visibility ?? 'internal'),
            path: cfg.path
          }
    const idx = fields.findIndex(f => f.name === name)
    if (idx >= 0) fields[idx] = field
    else fields.push(field)
    byName.set(name, field)
  }

  // `static config {trigram}` columns are stored as column names; resolve to property
  // keys for the bare-term predicate. Only textual columns participate.
  const trigram = (def.trigramColumns ?? [])
    .map(colName => byName.get(colName))
    .filter((f): f is QueryableField => !!f && f.textual)
    .map(f => f.propertyKey)

  return {
    tableName: def.tableName,
    fields,
    byName,
    relations,
    search: {fts, textColumns, ...(trigram.length ? {trigram} : {})}
  }
}

// Schemas are pure derivations of a (stable) model definition → memoize per
// (definition, depth).
const cache = new WeakMap<ModelDefinition, Map<number, QuerySchema>>()

/** The query schema for a model — derived once per depth, then cached. */
export function buildQuerySchema(
  def: ModelDefinition,
  depth: number = MAX_RELATION_DEPTH
): QuerySchema {
  let byDepth = cache.get(def)
  if (!byDepth) {
    byDepth = new Map()
    cache.set(def, byDepth)
  }
  let schema = byDepth.get(depth)
  if (!schema) {
    schema = build(def, depth)
    byDepth.set(depth, schema)
  }
  return schema
}

/** Public-queryable field names, for error messages / discoverability. */
export function publicFieldNames(schema: QuerySchema): string[] {
  return schema.fields.filter(f => f.visibility === 'public').map(f => f.name)
}
