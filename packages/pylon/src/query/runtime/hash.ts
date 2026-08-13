/**
 * Deterministic, order-independent serialization of a variables object, plus a
 * compact hash of it. Both the SSR render pass and the client must derive the
 * SAME key for a given (document, variables) pair so operation-keyed hydration
 * lines up — so object key order must not matter.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, replacer)
}

function replacer(_key: string, val: unknown): unknown {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      sorted[k] = (val as Record<string, unknown>)[k]
    }
    return sorted
  }
  return val
}

/** djb2 — small, fast, stable across server/browser. Hex-encoded. */
export function hashString(str: string): string {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i)
  }
  // >>> 0 → unsigned; base36 keeps it short.
  return (h >>> 0).toString(36)
}

export function variablesHash(variables: unknown): string {
  if (variables == null) return '0'
  return hashString(stableStringify(variables))
}
