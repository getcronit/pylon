// The single microtask-coalescing seam under every batcher in the ORM — belongsTo,
// hasMany, and the keyed-query engine (count/rows/aggregate). Each of those used to
// hand-roll the same skeleton (a per-request map → `queueMicrotask` flush → hand each
// caller its slice); they now differ only in the `load(keys) → Map` step they supply.
//
// Keyed by the ambient app-context (NOT the shared connection): concurrent requests
// have distinct contexts, so two requests with different principals never share a
// batch — a relation read can't leak another tenant's rows or policy.
import {appContextKey} from './app-context.js'

interface BatchState<K, V> {
  /** Runs once per flush with every accumulated key; missing keys fall back below. */
  load: (keys: K[]) => Promise<ReadonlyMap<K, V>>
  /** Value for a key the load didn't return (null instance, [], 0, …). */
  missing: () => V
  waiters: Map<K, Array<{resolve: (v: V) => void; reject: (e: unknown) => void}>>
  scheduled: boolean
}

/** A namespace of batches (one per batcher kind). Create with `createRealm()`. */
export type BatchRealm<K, V> = WeakMap<object, Map<string, BatchState<K, V>>>

export function createRealm<K, V>(): BatchRealm<K, V> {
  return new WeakMap()
}

/**
 * Enqueue THIS caller's `key` into the `(realm, token)` batch; on the next microtask
 * `load` runs ONCE over every accumulated key and each caller resolves with
 * `result.get(key) ?? missing()`. Callers sharing a token (same query shape) coalesce;
 * the `load`/`missing` from the batch's first caller are used for the whole batch.
 */
export function batchLoad<K, V>(
  realm: BatchRealm<K, V>,
  token: string,
  key: K,
  load: (keys: K[]) => Promise<ReadonlyMap<K, V>>,
  missing: () => V
): Promise<V> {
  const ctxKey = appContextKey()
  let perCtx = realm.get(ctxKey)
  if (!perCtx) realm.set(ctxKey, (perCtx = new Map()))
  let st = perCtx.get(token)
  if (!st) {
    st = {load, missing, waiters: new Map(), scheduled: false}
    perCtx.set(token, st)
  }
  const s = st
  return new Promise<V>((resolve, reject) => {
    const list = s.waiters.get(key) ?? []
    list.push({resolve, reject})
    s.waiters.set(key, list)
    if (!s.scheduled) {
      s.scheduled = true
      queueMicrotask(() => void flushRealm(realm, ctxKey, token))
    }
  })
}

async function flushRealm<K, V>(realm: BatchRealm<K, V>, ctxKey: object, token: string): Promise<void> {
  const perCtx = realm.get(ctxKey)
  const st = perCtx?.get(token)
  if (!perCtx || !st) return
  // Drop the batch before awaiting so accesses on the next tick start a fresh one.
  perCtx.delete(token)
  const keys = [...st.waiters.keys()]
  try {
    const result = await st.load(keys)
    for (const [k, waiters] of st.waiters) {
      const v = result.get(k) ?? st.missing()
      for (const w of waiters) w.resolve(v)
    }
  } catch (err) {
    for (const waiters of st.waiters.values()) for (const w of waiters) w.reject(err)
  }
}
