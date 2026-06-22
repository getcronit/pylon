/**
 * Contributor merge. The IR is built by a pipeline: the type-checker produces a
 * base IR (objects, operations, scalar/enum shapes), then optional contributors
 * (the ORM, queues, auth …) enrich it. `mergeIR` combines those contributions.
 *
 * Field-level reconciliation (`mergeFields`) is where type-checker *shape* meets
 * contributor *intent*: the checker knows a field's type, the ORM knows whether
 * it is persisted/hidden. They merge by name into one `Field`.
 */
import type {Entity, Field, PylonIR, TypeRef} from './ir.js'
import {emptyIR} from './ir.js'

/** Merge contributor `Field`s into base `Field`s by name (later wins per key). */
export function mergeFields(base: Field[], extra: Field[]): Field[] {
  const byName = new Map<string, Field>()
  for (const f of base) byName.set(f.name, f)
  for (const f of extra) {
    const prev = byName.get(f.name)
    if (!prev) {
      byName.set(f.name, f)
      continue
    }
    const merged = {...prev, ...f}
    // Enum columns: the ORM owns persistence (text + CHECK) but the type-checker
    // owns the GraphQL enum's identity (name + members). Keep the parser's type
    // rather than the ORM's placeholder `String`.
    if (f.column?.enum && prev.type) merged.type = prev.type
    // Paginated many-to-many: the type-checker emits it as a callable Relay
    // Connection (`field(first, …): TConnection`, with args + exposed). The ORM
    // contributes the SAME field only to carry join-table metadata for migrations,
    // marked `exposed: false` (so a plain m2m list isn't double-declared). That
    // placeholder must not hide or reshape the checker's Connection field — keep
    // the exposed callable shape, while retaining the ORM's join `relation` meta.
    if (
      f.relation?.kind === 'manyToMany' &&
      f.exposed === false &&
      prev.exposed &&
      prev.args
    ) {
      merged.exposed = true
      merged.type = prev.type
      merged.args = prev.args
    }
    byName.set(f.name, merged)
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

  // Reconcile across buckets: a persisted entity is the canonical type. The
  // type-checker also saw the model as a plain object (resolver-returned), and
  // that view carries any COMPUTED fields — methods/getters on the model class
  // that aren't columns or relations. Fold those object fields into the entity
  // (entity wins per name, so column/relation metadata stays authoritative;
  // object-only method fields are preserved), then drop the object.
  for (const name of Object.keys(out.entities)) {
    const obj = out.objects[name]
    if (obj) {
      out.entities[name] = {
        ...out.entities[name],
        fields: mergeFields(obj.fields, out.entities[name].fields)
      }
    }
    delete out.objects[name]
  }
  return out
}

/**
 * Drop enum types no field/argument/return references. When two contributors
 * describe the same field (e.g. the type-checker infers an enum from a string
 * union while the ORM names the same enum authoritatively), the loser's enum is
 * left dangling after the field reconciles. An unreferenced GraphQL enum is dead
 * weight — and at scale, a source of name collisions — so prune it. Only enums
 * are pruned; everything else is left intact.
 */
export function pruneUnreferencedEnums(ir: PylonIR): PylonIR {
  const referenced = new Set<string>()
  const visit = (t?: TypeRef): void => {
    if (!t) return
    if (t.kind === 'ref') referenced.add(t.name)
    else if (t.kind === 'list') visit(t.of)
  }
  const visitFields = (fields: Field[]): void => {
    for (const f of fields) visit(f.type)
  }
  for (const e of Object.values(ir.entities)) visitFields(e.fields)
  for (const o of Object.values(ir.objects)) visitFields(o.fields)
  for (const i of Object.values(ir.interfaces)) visitFields(i.fields)
  for (const inp of Object.values(ir.inputs)) visitFields(inp.fields)
  for (const op of ir.operations) {
    for (const a of op.args) visit(a.type)
    visit(op.returns)
  }
  const enums = Object.fromEntries(
    Object.entries(ir.enums).filter(([name]) => referenced.has(name))
  )
  return {...ir, enums}
}
