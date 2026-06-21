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
  /** In-flight fetch; present iff the operation is pending. */
  promise?: Promise<unknown>
  /** When `data` was written (ms epoch). Drives freshness decisions. */
  writtenAt?: number
  /** Marks an entry whose data is present but should be revalidated on next read. */
  stale?: boolean
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

  /** Shallow-merge entities into the table and notify. */
  mergeEntities(entities: Record<string, Record<string, unknown>>): void {
    const keys = Object.keys(entities)
    if (keys.length === 0) return
    for (const key of keys) {
      this.entities.set(key, {...this.entities.get(key), ...entities[key]})
    }
    this.emit()
  }

  /** Directly write/patch a single entity (manual cache writes, mutations). */
  writeEntity(key: string, fields: Record<string, unknown>): void {
    this.entities.set(key, {...this.entities.get(key), ...fields})
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
