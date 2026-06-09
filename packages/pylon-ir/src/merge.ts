/**
 * Contributor merge. The IR is built by a pipeline: the type-checker produces a
 * base IR (objects, operations, scalar/enum shapes), then optional contributors
 * (the ORM, queues, auth …) enrich it. `mergeIR` combines those contributions.
 *
 * Field-level reconciliation (`mergeFields`) is where type-checker *shape* meets
 * contributor *intent*: the checker knows a field's type, the ORM knows whether
 * it is persisted/hidden. They merge by name into one `Field`.
 */
import type {Entity, Field, PylonIR} from './ir.js'
import {emptyIR} from './ir.js'

/** Merge contributor `Field`s into base `Field`s by name (later wins per key). */
export function mergeFields(base: Field[], extra: Field[]): Field[] {
  const byName = new Map<string, Field>()
  for (const f of base) byName.set(f.name, f)
  for (const f of extra) {
    const prev = byName.get(f.name)
    byName.set(f.name, prev ? {...prev, ...f} : f)
  }
  return Array.from(byName.values())
}

function mergeEntity(base: Entity | undefined, extra: Entity): Entity {
  if (!base) return extra
  return {
    ...base,
    ...extra,
    fields: mergeFields(base.fields, extra.fields),
    implements: Array.from(new Set([...base.implements, ...extra.implements]))
  }
}

/** Combine partial IR contributions into one. */
export function mergeIR(...parts: Array<Partial<PylonIR>>): PylonIR {
  const out = emptyIR()
  for (const part of parts) {
    for (const [name, entity] of Object.entries(part.entities ?? {})) {
      out.entities[name] = mergeEntity(out.entities[name], entity)
    }
    Object.assign(out.objects, part.objects ?? {})
    Object.assign(out.interfaces, part.interfaces ?? {})
    Object.assign(out.unions, part.unions ?? {})
    Object.assign(out.inputs, part.inputs ?? {})
    Object.assign(out.enums, part.enums ?? {})
    if (part.scalars) out.scalars.push(...part.scalars.filter(s => !out.scalars.includes(s)))
    if (part.operations) out.operations.push(...part.operations)
  }

  // Reconcile across buckets: a persisted entity is the canonical type, so it
  // replaces any plain object of the same name (e.g. the type-checker saw an
  // ORM model as a resolver-returned object; the ORM's entity is authoritative).
  for (const name of Object.keys(out.entities)) {
    delete out.objects[name]
  }
  return out
}
