/**
 * Normalize a GraphQL response into a flat entity table + a ref tree.
 *
 * Any object carrying BOTH `__typename` and `id` is an entity: it's hoisted into
 * `entities["Type:id"]` and replaced inline with a `{__ref}`. Everything else
 * (root Query object, connections, edges, plain objects) stays inline. This is
 * what lets a mutation patch one entity and have every query that references it
 * update — the queries all point at the same `Type:id`.
 *
 * The compiler auto-selects `__typename` + `id` on every object that has them,
 * so this works without per-document configuration.
 */
export interface Ref {
  __ref: string
}

export function isRef(value: unknown): value is Ref {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Ref).__ref === 'string'
  )
}

export function entityKey(typename: string, id: unknown): string {
  return `${typename}:${String(id)}`
}

export interface NormalizeResult {
  /** The response with entities replaced by refs. */
  root: unknown
  /** typename:id → entity fields (nested entities are themselves refs). */
  entities: Record<string, Record<string, unknown>>
}

export function normalize(data: unknown): NormalizeResult {
  const entities: Record<string, Record<string, unknown>> = {}
  const root = walk(data, entities)
  return {root, entities}
}

function walk(
  value: unknown,
  entities: Record<string, Record<string, unknown>>
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => walk(item, entities))
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>
    const fields: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      fields[key] = walk(obj[key], entities)
    }
    const typename = obj.__typename
    const id = obj.id
    if (typeof typename === 'string' && id !== undefined && id !== null) {
      const key = entityKey(typename, id)
      // Shallow-merge so the same entity selected by different queries combines.
      entities[key] = {...entities[key], ...fields}
      return {__ref: key}
    }
    return fields
  }
  return value
}
