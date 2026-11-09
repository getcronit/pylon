/**
 * `resolveNode` — the runtime behind a Relay `node(id)` refetch field. Kept
 * separate from the pure `gid` codec so the codec (imported by the ORM's
 * where-builder for input decoding) carries no dependency on the manager.
 */
import {BadRequestError} from './errors.js'
import {fromGid} from './gid.js'
import {createManager} from './manager.js'
import {modelForTypeName} from './registry.js'

/**
 * Resolve a global id to its entity. Dispatches on the gid's type to the owning
 * model, then looks the row up by primary key through the normal manager (so
 * tenant scoping / policies still apply). Returns the row tagged with
 * `__typename` (for the GraphQL interface resolver), or `null` when no row
 * matches — never throws on a miss, per Relay semantics. Throws `BadRequestError`
 * only for a malformed gid or unknown type.
 */
export async function resolveNode(
  gid: string
): Promise<(Record<string, unknown> & {__typename: string}) | null> {
  const {type, id} = fromGid(gid)
  const def = modelForTypeName(type)
  if (!def) throw new BadRequestError(`Unknown type in global id: ${type}`)
  if (!def.primaryKey) {
    throw new BadRequestError(`Type ${type} has no primary key and cannot be resolved by id`)
  }
  const manager = createManager(def.ctor as new () => object)
  const row = await manager.filter({[def.primaryKey.propertyKey]: id} as never).first()
  if (row == null) return null
  // Model instances are guarded Proxies that reject writes of undeclared
  // properties, so we can't assign `__typename` onto the row. Front it with a
  // thin object that inherits the instance (columns + lazy relations resolve
  // through the prototype) and carries `__typename` as its own field.
  return Object.create(row as object, {
    __typename: {value: type, enumerable: true, writable: false, configurable: true}
  }) as Record<string, unknown> & {__typename: string}
}
