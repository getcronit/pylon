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

import type {ColumnDefinition, ModelDefinition} from './registry.js'

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

function build(def: ModelDefinition): QuerySchema {
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
  return {tableName: def.tableName, fields, byName, search: {fts, textColumns}}
}

// Schemas are pure derivations of a (stable) model definition → memoize per def.
const cache = new WeakMap<ModelDefinition, QuerySchema>()

/** The query schema for a model — derived once, then cached. */
export function buildQuerySchema(def: ModelDefinition): QuerySchema {
  let schema = cache.get(def)
  if (!schema) {
    schema = build(def)
    cache.set(def, schema)
  }
  return schema
}

/** Public-queryable field names, for error messages / discoverability. */
export function publicFieldNames(schema: QuerySchema): string[] {
  return schema.fields.filter(f => f.visibility === 'public').map(f => f.name)
}
