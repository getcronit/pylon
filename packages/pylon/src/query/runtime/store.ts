/**
 * Operation-keyed cache.
 *
 * Deliberately NOT a normalized graph (the gqty model we're replacing). Each
 * entry is keyed by `opKey(doc, variables)` and holds the raw operation result.
 * This is the "Relay-store-lite" baseline from the design doc: simple,
 * inspectable, and trivially serializable for hydration. Cross-query
 * consistency (mutation invalidation) is layered on top via `invalidate`/tags,
 * not via normalization.
 */
export interface StoreEntry {
  /** Resolved data, once available. */
  data?: unknown
  /** Terminal error, if the operation failed. */
  error?: unknown
  /**
   * Non-fatal field errors that rode alongside partial `data` (GraphQL allows
   * `data` and `errors` to coexist — e.g. a feature-gated field throws while its
   * siblings resolve). The operation is NOT failed: `data` holds the good fields
   * and reading a nulled-out errored field just yields `null`. Kept for surfacing
   * (dev warnings / debugging), never thrown from `ensure`.
   */
  partialErrors?: Array<{message: string}>
  /** In-flight fetch; present iff the operation is pending. */
  promise?: Promise<unknown>
  /** When `data` was written (ms epoch). Drives freshness decisions. */
  writtenAt?: number
  /** Marks an entry whose data is present but should be revalidated on next read. */
  stale?: boolean
}

/** A normalized ref pointer (`{__ref}`) — a value, never recursed into. */
const isRef = (v: unknown): v is {__ref: string} =>
  v != null && typeof v === 'object' && '__ref' in (v as object)

/** An inline (id-less) object — a connection wrapper, embedded object, etc. */
const isInlineObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v) && !isRef(v)

/**
 * Non-destructive deep merge of a canonical entity. Normalization is ADDITIVE:
 * a build-time op fetches its full document, so any field it selected is present
 * in its response — a later read must never see `undefined` for a selected field.
 * That can only happen if a NARROWER op overwrites the shared entity and drops a
 * field. So merging must never lose what's already loaded. Per field:
 *   - absent in `incoming` → keep `existing` (don't drop)
 *   - both inline objects (e.g. a connection `{nodes, totalCount}`) → recurse,
 *     so a `{totalCount}`-only write can't clobber a sibling op's `nodes`
 *   - both non-empty lists where `incoming`'s elements are all id-less inline
 *     objects but `existing` holds refs → keep `existing`. A narrower op that reads
 *     only e.g. `list.length` selects the list WITHOUT its elements' `id`, so its
 *     elements can't normalize to refs — they arrive as `{__typename}`-only inline
 *     objects. Letting those replace a wider op's `[ref, …]` is the partial-read
 *     clobber (the reader then sees `undefined` for every element field). This is
 *     NOT a real update: a genuine list refetch selects `id`, so it carries refs
 *     and still wins (add/remove/reorder), as does an empty list (cleared).
 *   - otherwise (scalar / array / ref / null / type change) → `incoming` wins
 * Arrays and refs otherwise replace wholesale, so a refetch stays authoritative for
 * a list (added/removed nodes) and for which entity a relation points at.
 */
export function mergeEntityFields(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  if (!existing) return incoming
  // Structural sharing: copy `existing` only once we hit a field that actually
  // changes. A refetch that returns identical data (the use-live-events case) then
  // returns the SAME object — so an untouched entity keeps its reference across
  // renders, which is what lets a wrapped node stay `===` and a memo'd row skip.
  let out = existing
  for (const k of Object.keys(incoming)) {
    const b = incoming[k]
    if (b === undefined) continue // never let an undefined erase a loaded field
    const a = existing[k]
    const merged = mergeValue(a, b)
    if (merged !== a || !(k in existing)) {
      if (out === existing) out = {...existing}
      out[k] = merged
    }
  }
  return out
}

/**
 * Merge one field value, preserving `existing`'s identity when the incoming value
 * is equal. Refs compare by target (`__ref`), inline objects recurse (sharing their
 * unchanged sub-tree), lists recurse element-wise and keep the old array when every
 * element is unchanged. The merge SEMANTICS are unchanged from the field-by-field
 * version above (incoming scalars/arrays/refs still win a real change, under-selected
 * lists are still rejected) — only identity is now preserved on no-ops.
 */
function mergeValue(a: unknown, b: unknown): unknown {
  if (a === b) return a
  if (isRef(a) && isRef(b)) return a.__ref === (b as {__ref: string}).__ref ? a : b
  if (Array.isArray(a) && Array.isArray(b)) {
    if (isUnderSelectedList(a, b)) return a // narrower-op artifact — keep the ref list
    if (a.length !== b.length) return b // add/remove/reorder → incoming wins wholesale
    let out = a
    for (let i = 0; i < b.length; i++) {
      const merged = mergeValue(a[i], b[i])
      if (merged !== a[i]) {
        if (out === a) out = a.slice()
        out[i] = merged
      }
    }
    return out
  }
  if (isInlineObject(a) && isInlineObject(b)) return mergeEntityFields(a, b)
  return b
}

/**
 * True when `incoming` would clobber a ref-bearing list with a non-empty list of
 * purely id-less objects — the partial-read case above. Empty `incoming` (a genuine
 * clear) and any `incoming` carrying a ref (a genuine refetch) return false.
 */
function isUnderSelectedList(existing: unknown, incoming: unknown): boolean {
  return (
    Array.isArray(existing) &&
    Array.isArray(incoming) &&
    incoming.length > 0 &&
    incoming.every(isInlineObject) && // no refs, no scalars → all id-less objects
    existing.some(isRef) // we'd be dropping identified rows
  )
}

export class Store {
  private map = new Map<string, StoreEntry>()
  /** Canonical entities, keyed "Type:id". Operation data holds refs into this. */
  private entities = new Map<string, Record<string, unknown>>()
  private listeners = new Set<() => void>()
  private version = 0

  /**
   * Monotonic change counter for `useSyncExternalStore`. Bumped on every write.
   * Arrow property so its identity is stable across renders.
   */
  getVersion = (): number => this.version

  get(key: string): StoreEntry | undefined {
    return this.map.get(key)
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  set(key: string, entry: StoreEntry): void {
    this.map.set(key, entry)
    this.emit()
  }

  /**
   * Merge a patch into an entry (creating it if absent). Notifies unless
   * `silent` — setting only the in-flight `promise` must NOT notify, because
   * `ensure()` runs during render (a stale read kicks a background revalidation),
   * and emitting there triggers a setState-during-render warning. Data/error
   * writes (always async, post-network) emit normally.
   */
  patch(key: string, patch: Partial<StoreEntry>, silent = false): StoreEntry {
    const next = {...this.map.get(key), ...patch}
    this.map.set(key, next)
    if (!silent) this.emit()
    return next
  }

  delete(key: string): void {
    if (this.map.delete(key)) this.emit()
  }

  /** Mark matching entries stale so the next read revalidates. */
  invalidate(predicate: (key: string) => boolean): void {
    let changed = false
    for (const [key, entry] of this.map) {
      if (predicate(key) && entry.data !== undefined && !entry.stale) {
        this.map.set(key, {...entry, stale: true})
        changed = true
      }
    }
    if (changed) this.emit()
  }

  // Arrow property so it stays bound when passed directly to
  // `useSyncExternalStore(store.subscribe, …)` — a plain method would lose `this`.
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  // ── entities ───────────────────────────────────────────────────────────────

  /** Read a canonical entity (current value — reads reflect later mutations). */
  getEntity = (key: string): Record<string, unknown> | undefined =>
    this.entities.get(key)

  /** Non-destructive deep-merge of entities into the table and notify. */
  mergeEntities(entities: Record<string, Record<string, unknown>>): void {
    const keys = Object.keys(entities)
    if (keys.length === 0) return
    for (const key of keys) {
      this.entities.set(key, mergeEntityFields(this.entities.get(key), entities[key]))
    }
    this.emit()
  }

  /** Directly write/patch a single entity (manual cache writes, mutations). */
  writeEntity(key: string, fields: Record<string, unknown>): void {
    this.entities.set(key, mergeEntityFields(this.entities.get(key), fields))
    this.emit()
  }

  entitiesSnapshot(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {}
    for (const [key, value] of this.entities) out[key] = value
    return out
  }

  hydrateEntities(record: Record<string, Record<string, unknown>> | undefined | null): void {
    if (!record) return
    for (const key of Object.keys(record)) {
      if (!this.entities.has(key)) this.entities.set(key, record[key])
    }
    this.emit()
  }

  /**
   * Flat, operation-keyed snapshot of resolved data only — what SSR serializes
   * into `window.__pylon`. In-flight promises and errors are intentionally
   * dropped; the client re-fetches anything that didn't resolve.
   */
  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of this.map) {
      if (entry.data !== undefined && entry.error === undefined) {
        out[key] = entry.data
      }
    }
    return out
  }

  /** Seed resolved data from a `window.__pylon` payload (client hydration). */
  hydrate(record: Record<string, unknown> | undefined | null): void {
    if (!record) return
    const now = Date.now()
    for (const key of Object.keys(record)) {
      if (!this.map.has(key)) {
        this.map.set(key, {data: record[key], writtenAt: now})
      }
    }
    this.emit()
  }

  private emit(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }
}
