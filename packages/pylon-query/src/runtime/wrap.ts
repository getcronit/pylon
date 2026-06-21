import type {FieldDesc, SchemaDescriptor} from './descriptor'

/**
 * Wrap a resolved GraphQL result (plain JSON) so component code can read it in
 * the Pylon authoring style:
 *
 *   data.me.name                      // object → property → scalar (raw value)
 *   data.posts(first, cursor).edges   // arg field → callable → object
 *   data.tags                         // list → real array of wrapped items
 *
 * Key correctness rules vs a naive "everything is a proxy":
 *  - Scalar/enum leaves return the RAW value, so `===`, truthiness and
 *    `JSON.stringify` behave exactly like the real data.
 *  - Lists return REAL arrays (wrapped elements), so `.map`/`.length`/spread
 *    and `Array.isArray` work.
 *  - Arg-taking fields are callable; the call args are decorative at read time
 *    (they were already baked into the document + variables at build time), so
 *    calling just descends into the resolved value.
 *
 * The wrapper is schema-driven (no per-document config) and never records
 * selections or normalizes — the analyzer already produced the query.
 *
 * `getRoot()` is the suspense trip-wire: it throws the in-flight promise on a
 * cache miss. Because the first field access happens in JSX — *below* the
 * component's `const` declarations — evaluating variables there is past any
 * temporal dead zone. That is the TDZ fix, for free.
 */
export function wrapResult<T = any>(
  getRoot: () => any,
  descriptor: SchemaDescriptor,
  rootExtras?: Record<string, unknown>
): T {
  return buildObject(getRoot, descriptor.query, descriptor, rootExtras) as T
}

function buildField(
  getOwner: () => any,
  ownerType: string,
  fieldName: string,
  descriptor: SchemaDescriptor
): unknown {
  const fd = descriptor.types[ownerType]?.[fieldName]
  const getValue = () => {
    const owner = getOwner()
    return owner == null ? undefined : owner[fieldName]
  }

  // Unknown field (e.g. concrete-type field read through an interface, or
  // __typename): fall back to the raw resolved value.
  if (!fd) return getValue()

  if (fd.callable) {
    return (..._args: unknown[]) => buildValue(getValue, fd, descriptor)
  }
  return buildValue(getValue, fd, descriptor)
}

function buildValue(
  getValue: () => any,
  fd: FieldDesc,
  descriptor: SchemaDescriptor
): unknown {
  if (fd.scalar) return getValue()

  if (fd.list) {
    const arr = getValue()
    if (arr == null) return arr
    const elemDesc: FieldDesc = {...fd, list: false}
    return (arr as unknown[]).map((_item, i) =>
      buildValue(() => getValue()[i], elemDesc, descriptor)
    )
  }

  const v = getValue()
  if (v == null) return v
  return buildObject(getValue, fd.type, descriptor)
}

function buildObject(
  getValue: () => any,
  typeName: string,
  descriptor: SchemaDescriptor,
  rootExtras?: Record<string, unknown>
): unknown {
  return new Proxy(Object.create(null), {
    get(_t, key) {
      if (typeof key === 'symbol') {
        // Non-thenable, non-iterable: avoid React/await mis-handling.
        return undefined
      }
      if (key === 'then') return undefined
      if (key === 'toJSON') return () => getValue()
      if (rootExtras && Object.prototype.hasOwnProperty.call(rootExtras, key)) {
        return rootExtras[key]
      }
      if (key === '__typename') return getValue()?.__typename
      return buildField(getValue, typeName, key, descriptor)
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
