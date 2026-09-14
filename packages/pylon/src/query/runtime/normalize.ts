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
import type {SlotResolver} from './storage-key'

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

export function normalize(
  data: unknown,
  slotResolver?: SlotResolver
): NormalizeResult {
  const entities: Record<string, Record<string, unknown>> = {}
  const root = walk(data, entities, slotResolver)
  return {root, entities}
}

function walk(
  value: unknown,
  entities: Record<string, Record<string, unknown>>,
  slotResolver?: SlotResolver
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => walk(item, entities, slotResolver))
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>
    const typename = obj.__typename
    const id = obj.id
    const isEntity =
      typeof typename === 'string' && id !== undefined && id !== null
    const fields: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      // Un-alias a union-branch alias back to its base field. The compiler aliases a
      // field selected on several union members with CONFLICTING types (e.g.
      // `status` = TicketStatus vs TaskStatus) as `status__pqAbs__Ticket: status` so
      // the query merges; only the matching member's alias is ever present, so
      // stripping the marker restores `status` transparently for reads.
      const marker = key.indexOf('__pqAbs__')
      const base = marker === -1 ? key : key.slice(0, marker)
      // An ARG-BEARING field on an ENTITY is stored under an args-inclusive key so a
      // different-args selection of the same field on the SAME entity (from another
      // operation) can't clobber it — a bare field name is only a valid entity slot for
      // an argument-free field. Non-entity objects (root, connections) keep the response
      // key: they live per-operation and never share a slot cross-query.
      const slot = isEntity ? slotResolver?.(typename as string, key) : undefined
      fields[slot ?? base] = walk(obj[key], entities, slotResolver)
    }
    if (isEntity) {
      const key = entityKey(typename as string, id)
      // Shallow-merge so the same entity selected by different queries combines.
      entities[key] = {...entities[key], ...fields}
      return {__ref: key}
    }
    return fields
  }
  return value
}
