import type {FieldDesc, SchemaDescriptor} from './descriptor'

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
}

const IDENTITY: Deref = value => value

export function wrapResult<T = any>(
  getRoot: () => any,
  descriptor: SchemaDescriptor,
  rootExtras?: Record<string, unknown>,
  deref: Deref = IDENTITY,
  rootTypeName: string = descriptor.query
): T {
  const ctx: Ctx = {descriptor, deref}
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
  const fd = ctx.descriptor.types[ownerType]?.[fieldName]
  const getValue = () => {
    const owner = getOwner()
    return owner == null ? undefined : ctx.deref(owner[fieldName])
  }

  // Unknown field (concrete-type field via an interface, or __typename): raw.
  if (!fd) return getValue()

  if (fd.callable) {
    return (..._args: unknown[]) => buildValue(getValue, fd, ctx)
  }
  return buildValue(getValue, fd, ctx)
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
  if (v == null) return v
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
