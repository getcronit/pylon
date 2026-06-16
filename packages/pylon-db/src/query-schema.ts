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

/** One queryable field on a model. Phase 1 only produces `kind: 'column'`. */
export interface QueryableField {
  /** Public field name used in the query (defaults to the property key). */
  name: string
  kind: 'column'
  propertyKey: string
  columnName: string
  sqlType: string
  /** Enum members, if the column is an enum (values stay raw — never coerced). */
  enumValues?: readonly string[]
  /** Text-ish column → supports `contains` / `startsWith` (ILIKE). */
  textual: boolean
  ops: QueryOp[]
  visibility: FieldVisibility
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

/** The bare-term search target: a generated tsvector (FTS) or the substring fallback. */
export interface SearchTarget {
  /** A `@model({search})` tsvector column → FTS (`@@`). */
  fts?: {propertyKey: string; language: string}
  /** Property keys of textual columns used for the substring fallback (no FTS). */
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
      // Phase 1 default: own scalar columns are public (see QUERY_API_DESIGN.md §4.3).
      visibility: 'public'
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
      const targetDef = getModelDefinition(rel.target())
      if (!targetDef) continue // unresolved target → not traversable
      relations.set(rel.propertyKey, {
        name: rel.propertyKey,
        propertyKey: rel.propertyKey,
        kind: rel.kind,
        toMany: rel.kind === 'hasMany' || rel.kind === 'manyToMany',
        // Relations are internal until explicitly opted into the public surface
        // (Phase 3: @model({query:{public}})).
        visibility: 'internal',
        target: () => buildQuerySchema(targetDef, depth - 1)
      })
    }
  }

  return {tableName: def.tableName, fields, byName, relations, search: {fts, textColumns}}
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
