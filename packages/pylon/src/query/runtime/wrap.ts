import type {FieldDesc, SchemaDescriptor} from './descriptor'
import {stableStringify} from './hash'

/**
 * Per-operation routing for a field read with multiple different-args call sites:
 * `Type.field` → (stableStringify(callArgs) → response alias). Built at the read path from
 * the doc's `argAliases` metadata + the resolved variables. Lets `data.…field(args)` resolve
 * to the aliased response slot whose args match the call (instead of always the first).
 *
 * Keyed by OWNER TYPE + field so it works at any depth — the reader knows the type of the
 * object it is reading from, but not its document path.
 *
 * Supplied as a thunk because the variables it needs are evaluated lazily (TDZ-safe) at
 * first field access; the thunk is invoked inside the field call, past that point.
 */
export type ArgAliasMap = Record<string, Record<string, string>>
export type ArgAliasMapSource = ArgAliasMap | (() => ArgAliasMap | undefined)

/**
 * Build the read-time `ArgAliasMap` from a doc's compile-time `argAliases` (`Type.field` →
 * branches of `{alias, arg→variable}`) plus the operation's resolved `variables`. Each
 * branch's resolved args are hashed the SAME way a field call's args are — so
 * `data.field(args)` routes to the branch whose args match.
 */
export function buildArgAliasMap(
  argAliases: Record<string, Array<{alias: string; args: Record<string, string>}>>,
  variables: Record<string, unknown> | undefined
): ArgAliasMap {
  const out: ArgAliasMap = {}
  for (const [field, branches] of Object.entries(argAliases)) {
    const byHash: Record<string, string> = {}
    for (const {alias, args} of branches) {
      const resolved: Record<string, unknown> = {}
      for (const [argName, varName] of Object.entries(args)) {
        resolved[argName] = variables?.[varName]
      }
      byHash[stableStringify(resolved)] = alias
    }
    out[field] = byHash
  }
  return out
}

/**
 * Wrap a resolved GraphQL result so component code can read it in the Pylon
 * authoring style:
 *
 *   data.me.name                      // object → property → scalar (raw value)
 *   data.posts(first, cursor).edges   // arg field → callable → object
 *   data.tags                         // list → real array of wrapped items
 *
 * Correctness rules vs a naive "everything is a proxy":
 *  - Scalar/enum leaves return the RAW value (so `===`, truthiness, JSON behave).
 *  - Lists return REAL arrays of wrapped elements.
 *  - Arg-taking fields stay callable; the call args are decorative at read time
 *    (already baked into the document + variables at build time).
 *
 * `deref` resolves normalized `{__ref}` values into their canonical entity. It's
 * applied at every value boundary, so reads always reflect the LIVE entity table
 * — that is how a mutation patching one entity updates every reader. For the
 * non-normalized case `deref` is identity and behavior is unchanged.
 *
 * `getRoot()` is the suspense trip-wire: it throws the in-flight promise on a
 * cache miss. The first field access happens in JSX — below the component's
 * `const`s — so evaluating variables there is past any temporal dead zone.
 */
export type Deref = (value: any) => any

interface Ctx {
  descriptor: SchemaDescriptor
  deref: Deref
  /** Operation label for diagnostics (which doc served this read). */
  debugLabel?: string
  /** Root type name (still needed for the root object's own descriptor lookup). */
  rootType: string
  /** `Type.field` → arg→alias routing for same-field/different-args reads (may be a thunk). */
  argAliasMap?: ArgAliasMapSource
}

const IDENTITY: Deref = value => value

// ── DEV diagnostic: partial-entity reads ────────────────────────────────────
// Fires when component code reads a schema field that is MISSING from the cached
// entity (the entity was populated by a query that didn't select it). This is the
// silent "hole" that surfaces as `undefined` and crashes downstream
// (`undefined.map`). Deduped per op|entity|field. Temporary instrumentation to
// capture the exact op/entity/field/state at the bug site.
const seenHoles = new Set<string>()
function reportPartialRead(owner: any, fieldName: string, ctx: Ctx): void {
  if (owner == null || typeof owner !== 'object') return
  if (fieldName in owner) return // present (even if null) → genuinely loaded
  if (!owner.__typename) return // only entity-like nodes (skip the inline op root)
  const id = owner.id ?? '?'
  const tag = `${ctx.debugLabel ?? '?'}|${owner.__typename}:${id}.${fieldName}`
  if (seenHoles.has(tag)) return
  seenHoles.add(tag)
  // eslint-disable-next-line no-console
  console.warn(
    `[pylon-query] PARTIAL READ — op "${ctx.debugLabel ?? '?'}" read ` +
      `${owner.__typename}:${id}.${fieldName}, but that field is ABSENT from the cached ` +
      `entity (a narrower query populated it). Present fields: [${Object.keys(owner).join(', ')}]. ` +
      `Returning undefined instead of refetching → this is the partial-read bug.`,
    {op: ctx.debugLabel, entity: owner}
  )
}

export function wrapResult<T = any>(
  getRoot: () => any,
  descriptor: SchemaDescriptor,
  rootExtras?: Record<string, unknown>,
  deref: Deref = IDENTITY,
  rootTypeName: string = descriptor.query,
  debugLabel?: string,
  argAliasMap?: ArgAliasMapSource
): T {
  const ctx: Ctx = {
    descriptor,
    deref,
    debugLabel,
    rootType: rootTypeName,
    argAliasMap
  }
  return buildObject(
    () => ctx.deref(getRoot()),
    rootTypeName,
    ctx,
    rootExtras
  ) as T
}

function buildField(
  getOwner: () => any,
  ownerType: string,
  fieldName: string,
  ctx: Ctx
): unknown {
  let fd = ctx.descriptor.types[ownerType]?.[fieldName]
  const getValue = () => {
    const owner = getOwner()
    return owner == null ? undefined : ctx.deref(owner[fieldName])
  }

  // Polymorphic dispatch: a field not on the static (interface/union) type is
  // resolved via the value's runtime __typename → its concrete type's descriptor.
  if (!fd) {
    const tn = getOwner()?.__typename
    if (tn) fd = ctx.descriptor.types[tn]?.[fieldName]
  }

  // Truly unknown field → raw value.
  if (!fd) return getValue()

  reportPartialRead(getOwner(), fieldName, ctx)

  if (fd.callable) {
    // Same field read with different args at multiple call sites → the compiler emitted an
    // aliased response slot per branch; route this call to the slot whose args match. Any
    // field carrying an argAliases entry qualifies, at any depth (it used to be root-only,
    // so a nested `ticket.timeline({query})` read three ways silently served the first
    // one's data three times); everything else ignores args, which are baked into the
    // document + variables at build time. The map thunk is resolved INSIDE the call (not
    // at property-access), so root-resolution timing is unchanged.
    const call = (...args: unknown[]) => {
      const src = ctx.argAliasMap
      const map = typeof src === 'function' ? src() : src
      // `Type.field`; the bare name is the pre-typed-key fallback for a stale build.
      const aliases = map?.[`${ownerType}.${fieldName}`] ?? map?.[fieldName]
      if (aliases) {
        const alias = aliases[stableStringify(args[0] ?? {})] ?? fieldName
        const getAliased = () => {
          const owner = getOwner()
          return owner == null ? undefined : ctx.deref((owner as any)[alias])
        }
        return buildValue(getAliased, fd, ctx)
      }
      return buildValue(getValue, fd, ctx)
    }
    // A callable with any REQUIRED arg is call-only (`data.field(args)`): a bare
    // read can't produce a valid value, so return the plain function.
    if (!fd.optionalArgs) return call
    // Every arg optional → dual-mode: usable as a bare property (`data.field`) OR
    // called (`data.field()` / `data.field(args)`). Return a value that both
    // coerces/forwards to the no-arg result AND stays callable.
    return makeDualMode(call)
  }
  return buildValue(getValue, fd, ctx)
}

/**
 * Wrap a resolved-value thunk so the field reads BOTH as the value and as a call.
 * The Proxy's `apply` runs the call; every other access (coercion, property,
 * method) is forwarded to the resolved no-arg value — so `img.url` coerces to the
 * URL string, `img.url.startsWith(…)` works, and `img.url({…})` still calls.
 *
 * NOTE: the result is `typeof 'function'`, so it can't be passed straight into a
 * React DOM prop (`src={img.url}` → React drops the attribute). For an `<img>`,
 * CALL the field — `img.url()` / `img.url({transform})` — which returns the plain
 * (already server-transformed) URL string.
 */
function makeDualMode(call: (...args: unknown[]) => any): unknown {
  return new Proxy(call, {
    apply: (_t, _this, args) => call(...args),
    get(target, key, recv) {
      if (key === Symbol.toPrimitive) return () => call()
      if (key === 'valueOf') return () => call()
      if (key === 'toString') {
        return () => {
          const v = call()
          return v == null ? '' : String(v)
        }
      }
      if (typeof key === 'symbol') return Reflect.get(target, key, recv)
      const v = call()
      if (v == null) return undefined
      const inner = (v as any)[key]
      return typeof inner === 'function' ? inner.bind(v) : inner
    }
  })
}

function buildValue(getValue: () => any, fd: FieldDesc, ctx: Ctx): unknown {
  if (fd.scalar) return getValue()

  if (fd.list) {
    const arr = getValue()
    if (arr == null) return arr
    const elemDesc: FieldDesc = {...fd, list: false}
    return (arr as unknown[]).map((_item, i) =>
      buildValue(() => ctx.deref(getValue()[i]), elemDesc, ctx)
    )
  }

  const v = getValue()
  // A genuinely NULLABLE object → hand back the null/undefined so the app can guard it
  // (`if (!x)`, `x?.field`). A NON-NULL object that is nonetheless absent is a PARTIAL /
  // transient read — e.g. a connection that momentarily dropped out of the op result during
  // a refetch merge: the schema says it can't be null, so wrap the absent value instead of
  // returning a bare `undefined`. Nested reads then degrade to `undefined` (buildObject is
  // null-safe) rather than throwing `x.totalCount` and crashing the caller. `reportPartialRead`
  // in buildField has already logged the hole.
  if (v == null && !fd.nonNull) return v
  return buildObject(getValue, fd.type, ctx)
}

function buildObject(
  getValue: () => any,
  typeName: string,
  ctx: Ctx,
  rootExtras?: Record<string, unknown>
): unknown {
  return new Proxy(Object.create(null), {
    get(_t, key) {
      if (typeof key === 'symbol') return undefined
      if (key === 'then') return undefined
      if (key === 'toJSON') return () => getValue()
      if (rootExtras && Object.prototype.hasOwnProperty.call(rootExtras, key)) {
        return rootExtras[key]
      }
      if (key === '__typename') return getValue()?.__typename
      return buildField(getValue, typeName, key, ctx)
    },
    has(_t, key) {
      const v = getValue()
      return v != null && key in v
    },
    ownKeys() {
      const v = getValue()
      return v ? Reflect.ownKeys(v) : []
    },
    getOwnPropertyDescriptor(_t, key) {
      const v = getValue()
      if (v != null && typeof key === 'string' && key in v) {
        return {enumerable: true, configurable: true, writable: false, value: undefined}
      }
      return undefined
    }
  })
}
