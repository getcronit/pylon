/**
 * Global object ids (`gid`) — Shopify-style opaque, type-qualified handles for
 * entities, in the shape `gid://pylon/<TypeName>/<localId>`:
 *
 * ```
 * gid://pylon/Order/123456789012345
 *       ^^^^^ ^^^^^ ^^^^^^^^^^^^^^^^^
 *       ns    type  raw primary key (e.g. a snowflake / cuid / uuid)
 * ```
 *
 * The gid is a pure *presentation* wrapper: storage and every foreign key stay
 * raw. Encoding happens per-field (only the field level knows its type name);
 * decoding happens wherever a gid comes back in — the `node()` refetch entry
 * point (dispatch by type) or an ORM where-clause (validate type, use localId).
 *
 * `<TypeName>` is the GraphQL type name, which in Pylon IS the model's
 * (underscore-normalized) class name — see `modelForTypeName`. The `localId`
 * segment is opaque and may itself contain `/`, so decoding splits on the first
 * three separators only.
 */
import {BadRequestError} from './errors.js'

/** Default URI scheme host segment — Pylon's analogue of Shopify's `shopify`. */
export const GID_NAMESPACE = 'pylon'

// The active namespace, configurable via `the node option's namespace`. Kept in a
// process global (not just a module var) so the build-serialized `id` encoder in
// `resolvers.js` — which has no imports in scope — can read the same value.
const GID_PREFIX_GLOBAL = '__PYLON_GID_PREFIX__'
function currentPrefix(): string {
  return (globalThis as Record<string, unknown>)[GID_PREFIX_GLOBAL] as string ?? `gid://${GID_NAMESPACE}/`
}

/**
 * Set the process-wide gid namespace (`gid://<namespace>/…`). Called by
 * `the node option's namespace`. Also seeds the process global the emitted `id`
 * encoder reads, so encode (build-serialized) and decode (here) always agree.
 */
export function setGidNamespace(namespace: string): void {
  ;(globalThis as Record<string, unknown>)[GID_PREFIX_GLOBAL] = `gid://${namespace}/`
}

/** Build a global id from a GraphQL type name and a raw primary key. */
export function toGid(typeName: string, localId: string | number | bigint): string {
  return `${currentPrefix()}${typeName}/${localId}`
}

export interface ParsedGid {
  namespace: string
  type: string
  /** The raw primary key, as a string (opaque — never coerced to a number). */
  id: string
}

/**
 * Parse a global id into its parts. Throws `BadRequestError` (400) on anything
 * that isn't a `gid://<ns>/<Type>/<id>` with a non-empty type and id.
 */
export function fromGid(gid: string): ParsedGid {
  if (typeof gid !== 'string' || !gid.startsWith('gid://')) {
    throw new BadRequestError(`Malformed global id: ${String(gid)}`)
  }
  // gid://<ns>/<Type>/<id...> — split into exactly 4 parts so an id containing
  // '/' survives intact.
  const rest = gid.slice('gid://'.length)
  const slash1 = rest.indexOf('/')
  const slash2 = slash1 === -1 ? -1 : rest.indexOf('/', slash1 + 1)
  if (slash1 === -1 || slash2 === -1) {
    throw new BadRequestError(`Malformed global id: ${gid}`)
  }
  const namespace = rest.slice(0, slash1)
  const type = rest.slice(slash1 + 1, slash2)
  const id = rest.slice(slash2 + 1)
  if (!namespace || !type || !id) {
    throw new BadRequestError(`Malformed global id: ${gid}`)
  }
  return {namespace, type, id}
}

/** True for a well-formed `gid://…` string in the active namespace (never throws). */
export function isGid(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(currentPrefix())
}

/**
 * Decode a value that may be a gid OR a bare local id, returning the raw local
 * id. When `expectedType` is given and the value is a gid, its embedded type
 * must match — passing a `User` gid where an `Order` is expected throws. Bare
 * ids pass through untouched, which keeps input back-compatible while clients
 * migrate to sending gids.
 */
export function decodeId(value: string, expectedType?: string): string {
  if (!isGid(value)) return value
  const {type, id} = fromGid(value)
  if (expectedType && type !== expectedType) {
    throw new BadRequestError(
      `Expected a ${expectedType} id but received a ${type} id (${value})`
    )
  }
  return id
}
