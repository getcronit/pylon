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
    // Enum columns: the ORM owns persistence (text + CHECK + NULL-ability) but the
    // type-checker owns the GraphQL enum's identity (name + members). Keep the parser's
    // enum type rather than the ORM's placeholder `String`, but take NULL-ability from
    // the ORM column — else an enum column that is non-null (or nullable) renders with
    // the analyzer's inferred nullability instead (e.g. a non-null enum without a
    // default would wrongly emit as nullable).
    if (f.column?.enum && prev.type) {
      merged.type = {...prev.type, nullable: f.type.nullable}
    }
    // Struct columns (`models.Struct<T>`): same split as enums. The ORM owns persistence
    // (a `jsonb` column) but the type-checker owns the exposed STRUCTURED type `T`. Keep the
    // parser's reflected object type instead of the ORM's `JSON` placeholder, taking NULL-ability
    // from the ORM column. (A plain `models.JSON` column has no `struct` flag, so its `JSON`
    // scalar wins here and the parser's reflected type is left dangling — see the orphan prune.)
    if (f.column?.struct && prev.type) {
      merged.type = {...prev.type, nullable: f.type.nullable}
    }
    // A HIDDEN many-to-many relation must never shadow an EXPOSED field of the same
    // (stripped) name. Two cases:
    //  - the paginated m2m: the checker emits a callable Relay Connection (with args);
    //    the ORM contributes the same field `exposed: false` only to carry join-table meta.
    //  - a hidden `$`-relation whose stripped name collides with an exposed accessor —
    //    e.g. `$media = m2m(...)` (strips to `media`) alongside a `media()` method.
    // Keep the exposed field's schema shape (type/args/exposed), while RETAINING the ORM's
    // join `relation` meta so migrations still synthesize the join table (`joinTablesOf`).
    // Runtime resolves the field via the accessor/Connection, not the raw relation.
    if (f.relation?.kind === 'manyToMany' && f.exposed === false && prev.exposed) {
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
        fields: mergeFields(obj.fields, out.entities[name].fields),
        // Carry the object view's `implements` too. The type-checker learns a model
        // is a member of a union-derived INTERFACE (e.g. `SearchEntity`) and records
        // it on the object; without this union, that membership is lost when the
        // object folds into the authoritative entity, leaving the interface with no
        // implementers (so `... on Ticket` can't resolve). Union, entity-first.
        implements: Array.from(
          new Set([...out.entities[name].implements, ...(obj.implements ?? [])])
        )
      }
    }
    delete out.objects[name]
  }

  // Reconcile a union-derived interface's field TYPES with its implementer entities.
  // The interface was built from the type-checker's object view of the members (e.g.
  // `id: String!`), but the authoritative entity types differ (`id: ID!`) — leaving the
  // interface unimplementable ("interface field expects String! but Ticket.id is ID!").
  // Adopt an implementer entity's field types so `implements` is valid. Interfaces
  // implemented only by plain objects (no entity implementer) are untouched.
  for (const iface of Object.values(out.interfaces)) {
    const impl = Object.values(out.entities).find(e => e.implements.includes(iface.name))
    if (!impl) continue
    const byName = new Map(impl.fields.map(f => [f.name, f]))
    iface.fields = iface.fields.map(f => {
      const authoritative = byName.get(f.name)
      return authoritative ? {...f, type: authoritative.type} : f
    })
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

/**
 * Drop plain OBJECT types nothing reaches. A `models.JSON<T>` column reflects its generic `T` as
 * an object type via the type-checker, but the ORM collapses the column to the `JSON` scalar — so
 * `T` (and anything only `T` referenced, e.g. a nested `Target`) is left dangling in the SDL as an
 * orphan (in a fuller build it surfaces as a DUPLICATE entity type — invalid SDL). This prunes
 * exactly those: object types unreachable from any entity/interface/input/operation/union, followed
 * transitively through objects. A sibling `models.Struct<T>` column DOES reference `T` (mergeFields
 * keeps the structured type), so its object types stay referenced and survive.
 *
 * ONLY `objects` are pruned. Entities, interfaces, unions, enums, and scalars are untouched — an
 * entity is a schema type regardless of reachability, and interface/union possible-types are honored
 * (union members + any object that `implements` an interface are treated as roots), so this never
 * removes a type another type still needs.
 */
export function pruneUnreferencedObjectTypes(ir: PylonIR): PylonIR {
  const referenced = new Set<string>()
  const collect = (t?: TypeRef): void => {
    if (!t) return
    if (t.kind === 'ref') referenced.add(t.name)
    else if (t.kind === 'list') collect(t.of)
  }
  const collectFields = (fields: Field[]): void => {
    for (const f of fields) {
      collect(f.type)
      if (f.args) for (const a of f.args) collect(a.type)
    }
  }
  // Roots: everything a non-object schema member references keeps its target alive.
  for (const e of Object.values(ir.entities)) collectFields(e.fields)
  for (const i of Object.values(ir.interfaces)) collectFields(i.fields)
  for (const inp of Object.values(ir.inputs)) collectFields(inp.fields)
  for (const op of ir.operations) {
    for (const a of op.args) collect(a.type)
    collect(op.returns)
  }
  for (const u of Object.values(ir.unions)) for (const m of u.members) referenced.add(m)
  // An object that implements an interface is a possible-type — keep it even if no field names it.
  for (const [name, obj] of Object.entries(ir.objects)) {
    if (obj.implements?.length) referenced.add(name)
  }
  // Follow references THROUGH reachable objects (object → object) to a fixpoint, so a type used
  // only by another live object is kept, while a chain of pure orphans is dropped whole.
  for (let changed = true; changed; ) {
    changed = false
    for (const [name, obj] of Object.entries(ir.objects)) {
      if (!referenced.has(name)) continue
      const before = referenced.size
      collectFields(obj.fields)
      if (referenced.size !== before) changed = true
    }
  }
  const objects = Object.fromEntries(
    Object.entries(ir.objects).filter(([name]) => referenced.has(name))
  )
  return {...ir, objects}
}

/** Rewrite one type name → another everywhere in an IR (refs + implements + union members). */
function renameTypeAcross(ir: PylonIR, from: string, to: string): void {
  const fixRef = (t: TypeRef): TypeRef =>
    t.kind === 'list'
      ? {...t, of: fixRef(t.of)}
      : t.kind === 'ref' && t.name === from
        ? {...t, name: to}
        : t
  const fixFields = (fields: Field[]): void => {
    for (const f of fields) {
      f.type = fixRef(f.type)
      if (f.args) for (const a of f.args) a.type = fixRef(a.type)
    }
  }
  const fixImpl = (impl?: string[]): string[] | undefined =>
    impl ? Array.from(new Set(impl.map(n => (n === from ? to : n)))) : impl

  for (const e of Object.values(ir.entities)) {
    fixFields(e.fields)
    e.implements = fixImpl(e.implements) ?? []
  }
  for (const o of Object.values(ir.objects)) {
    fixFields(o.fields)
    o.implements = fixImpl(o.implements)
  }
  for (const i of Object.values(ir.interfaces)) {
    fixFields(i.fields)
    i.implements = fixImpl(i.implements)
  }
  for (const op of ir.operations) {
    op.returns = fixRef(op.returns)
    for (const a of op.args) a.type = fixRef(a.type)
  }
  for (const inp of Object.values(ir.inputs)) fixFields(inp.fields)
  for (const u of Object.values(ir.unions))
    u.members = u.members.map(m => (m === from ? to : m))
}

/**
 * Collapse an analyzer-generated `I<X>` interface into an ORM single-table-inheritance
 * interface `<X>`. When an STI base contributes `interface Asset` (no `I`), the
 * type-checker independently emits its conservative twin `interface IAsset` — plus
 * `... implements IAsset` and `field: IAsset` references. This drops the twin and
 * rewrites every reference to it, so the STI interface name (no prefix) is the sole
 * survivor. A no-op unless a bare interface `<X>` has an `I<X>` twin — which only
 * happens for STI, since the analyzer always `I`-prefixes its interfaces.
 */
export function collapseInterfaceTwins(
  ir: PylonIR,
  /** Out: collapsed twin → STI name (`IAsset` → `Asset`), for renaming resolvers. */
  renames?: Map<string, string>
): PylonIR {
  const collapsed: string[] = []
  for (const name of Object.keys(ir.interfaces)) {
    const twin = `I${name}`
    if (!ir.interfaces[twin]) continue
    renameTypeAcross(ir, twin, name)
    delete ir.interfaces[twin]
    collapsed.push(name)
    renames?.set(twin, name)
  }
  // Property-named ALIASES of an STI base: when the base is returned through a polymorphic
  // property — a mutation's `{item: Media}`, a `folder: Media`, … — the type-checker promotes
  // that position to a FRESH interface named after the PROPERTY (`Item`) whose implementers
  // are EXACTLY the base's subclasses. Fold each such alias into the base interface, so the
  // STI base keeps a single interface (and the alias's over-broad field set — it can even
  // include the base's HIDDEN columns — doesn't demand fields the subtypes don't expose).
  for (const x of collapsed) {
    const subs = new Set(
      Object.values(ir.entities)
        .filter(e => e.name !== x && e.implements.includes(x))
        .map(e => e.name)
    )
    if (!subs.size) continue
    for (const name of Object.keys(ir.interfaces)) {
      if (name === x || collapsed.includes(name)) continue
      const impls = Object.values(ir.entities)
        .filter(e => e.implements.includes(name))
        .map(e => e.name)
      if (impls.length === subs.size && impls.every(n => subs.has(n))) {
        renameTypeAcross(ir, name, x)
        delete ir.interfaces[name]
        renames?.set(name, x)
      }
    }
  }
  // For each collapsed STI interface `X`, the hidden base entity `X` may itself
  // implement OTHER interfaces — e.g. a promoted-union interface it was a member of
  // (`SearchEntity`). The base entity is hidden (renders no `type X`), so those
  // `implements` would be lost. Propagate them onto `X`'s concrete implementers (so
  // they satisfy those interfaces) and onto `X` itself (interface implements interface),
  // keeping the promoted-union interface's possible types correct.
  for (const x of collapsed) {
    const base = ir.entities[x]
    if (!base) continue
    const inherited = base.implements.filter(i => i !== x && !!ir.interfaces[i])
    if (!inherited.length) continue
    for (const e of Object.values(ir.entities)) {
      if (e.name !== x && e.implements.includes(x)) {
        e.implements = Array.from(new Set([...e.implements, ...inherited]))
      }
    }
    ir.interfaces[x].implements = Array.from(
      new Set([...(ir.interfaces[x].implements ?? []), ...inherited])
    )
  }
  // Fold each STI base entity's remaining EXPOSED fields (analyzer-contributed
  // computed methods like `url`/`itemCount`, merged in AFTER the ORM hid the
  // columns) into the interface, then fully suppress the entity's own object type —
  // otherwise those exposed fields render a concrete `type X` that collides with
  // `interface X`. The entity stays (hidden) so it still owns the physical table.
  for (const x of collapsed) {
    const entity = ir.entities[x]
    const iface = ir.interfaces[x]
    if (!entity || !iface) continue
    const have = new Set(iface.fields.map(f => f.name))
    for (const f of entity.fields) {
      if (f.exposed && !have.has(f.name)) {
        iface.fields.push({...f})
        have.add(f.name)
      }
    }
    entity.fields = entity.fields.map(f => ({...f, exposed: false}))
  }
  return ir
}
