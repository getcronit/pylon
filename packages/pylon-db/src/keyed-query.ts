// Keyed query batching — Phase 1 (explicit `paths`, count terminal). Coalesces N
// parameterized counts that share a shape into a handful of grouped queries per
// microtask, keyed on a caller-supplied value. See dd/KEYED_QUERY_BATCHING_DESIGN.md.
//
// Phase 1 reuses `QuerySet.groupedCountByFk` for BOTH path kinds instead of emitting
// UNION SQL: a `column` path is a direct grouped count; a `through` path fetches the
// (via → key) links once, grouped-counts the root by the join column, then rolls up.
// So a company's "own + team" open-ticket count is ~3 grouped queries for the whole
// page instead of one pair per row. Paths are assumed disjoint (sum, not UNION
// DISTINCT); the UNION/distinct generalisation + marker rewriter are later phases.
import {appContextKey} from './app-context.js'
import {columnFor, ModelCtor, QuerySet, type WhereInput} from './manager.js'
import {getModelDefinitionOrThrow, type ModelDefinition} from './registry.js'

/** One way a root row maps to the batch key. */
export type KeyProjection<T extends object> =
  | {
      /** The key IS this root column (`ticket.contactId = key`). */
      column: keyof T & string
    }
  | {
      /** The key is reached via a join model (`ticket.contactId = affiliation.personId`,
       *  and `affiliation.companyId` is the key). */
      through: ModelCtor<any>
      /** Through property linking to the root (`Affiliation.personId`). */
      on: string
      /** Root property the through joins to (`Ticket.contactId`). */
      to: keyof T & string
      /** Through property that IS the key (`Affiliation.companyId`). */
      key: string
      /** Fixed condition on the through rows (`{ isCurrent: true }`). */
      where?: WhereInput<any>
    }

export interface KeyedQueryOptions<T extends object> {
  /** THIS caller's key value (`this.id`). */
  key: unknown
  /** Shared, key-free predicate on the root (`{ status: OPEN }`). */
  where?: WhereInput<T>
  /** ≥1 projections; a row counts for a key if any projection maps it there. */
  paths: KeyProjection<T>[]
  unscoped?: boolean
}

/** Ordering spec (column name + direction), as `QuerySet` stores it. */
export type OrderSpec = {column: string; dir: 'asc' | 'desc'}

export interface KeyedTerminal<T extends object = any> {
  count(): Promise<number>
  exists(): Promise<boolean>
  all(order?: OrderSpec[]): Promise<T[]>
  first(order?: OrderSpec[]): Promise<T | null>
}

interface Batch<V> {
  root: ModelCtor<any>
  where?: WhereInput<any>
  paths: KeyProjection<any>[]
  unscoped: boolean
  waiters: Map<unknown, Array<{resolve: (v: V) => void; reject: (e: unknown) => void}>>
  scheduled: boolean
}
const countBatches = new WeakMap<object, Map<string, Batch<number>>>()
const rowsBatches = new WeakMap<object, Map<string, Batch<any[]>>>()

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x as object).sort().map(k => [k, (x as any)[k]]))
      : x
  )
}
function pathToken(p: KeyProjection<any>): string {
  return 'column' in p
    ? `c:${p.column}`
    : `t:${getModelDefinitionOrThrow(p.through).tableName}.${p.on}->${p.to}#${p.key}?${canon(p.where ?? {})}`
}

/** Enqueue THIS caller's key into a per-context, per-token batch; flush on the next
 *  microtask. The generic shared by every terminal (count vs rows). */
function enqueue<V>(
  map: WeakMap<object, Map<string, Batch<V>>>,
  kind: string,
  root: ModelCtor<any>,
  opts: KeyedQueryOptions<any>,
  flush: (ctxKey: object, token: string) => Promise<void>
): Promise<V> {
  const def = getModelDefinitionOrThrow(root)
  const ctxKey = appContextKey()
  const token =
    `${kind}:${def.tableName}${opts.unscoped ? '!u' : ''}` +
    `?w=${canon(opts.where ?? {})}&p=${opts.paths.map(pathToken).sort().join('|')}`
  let perCtx = map.get(ctxKey)
  if (!perCtx) {
    perCtx = new Map()
    map.set(ctxKey, perCtx)
  }
  let batch = perCtx.get(token)
  if (!batch) {
    batch = {
      root,
      where: opts.where,
      paths: opts.paths,
      unscoped: !!opts.unscoped,
      waiters: new Map(),
      scheduled: false
    }
    perCtx.set(token, batch)
  }
  const b = batch
  return new Promise<V>((resolve, reject) => {
    const list = b.waiters.get(opts.key) ?? []
    list.push({resolve, reject})
    b.waiters.set(opts.key, list)
    if (!b.scheduled) {
      b.scheduled = true
      queueMicrotask(() => void flush(ctxKey, token))
    }
  })
}

/** In-memory sort of hydrated rows by a QuerySet order spec (column → property). */
function sortRows<T>(rows: T[], root: ModelCtor<any>, order?: OrderSpec[]): T[] {
  if (!order?.length) return rows
  const def = getModelDefinitionOrThrow(root)
  const specs = order.map(o => ({
    prop: def.columns.find(c => c.columnName === o.column)?.propertyKey ?? o.column,
    dir: o.dir
  }))
  return [...rows].sort((a, b) => {
    for (const {prop, dir} of specs) {
      const av = (a as any)[prop]
      const bv = (b as any)[prop]
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
    }
    return 0
  })
}

/**
 * A keyed query: N callers sharing (root, where, paths) coalesce per microtask.
 * `count`/`exists` use grouped counts (disjoint-sum); `all`/`first` gather rows
 * (deduped by pk across paths, so overlapping paths are safe) and sort in memory.
 */
export function keyedQuery<T extends object>(
  root: ModelCtor<T>,
  opts: KeyedQueryOptions<T>
): KeyedTerminal<T> {
  return {
    count: () => enqueue(countBatches, 'count', root, opts, flushCount),
    exists: () => enqueue(countBatches, 'count', root, opts, flushCount).then(n => n > 0),
    all: order =>
      enqueue<any[]>(rowsBatches, 'rows', root, opts, flushRows).then(rows => sortRows(rows, root, order)),
    first: order =>
      enqueue<any[]>(rowsBatches, 'rows', root, opts, flushRows).then(
        rows => sortRows(rows, root, order)[0] ?? null
      )
  }
}

/** Build a scoped root QuerySet carrying the shared `where`. */
function baseOf(batch: Batch<any>): QuerySet<any> {
  let qs = new QuerySet(batch.root)
  if (batch.where) qs = qs.filter(batch.where)
  if (batch.unscoped) qs = qs.unscoped()
  return qs
}

async function flushCount(ctxKey: object, token: string): Promise<void> {
  const perCtx = countBatches.get(ctxKey)
  const batch = perCtx?.get(token)
  if (!perCtx || !batch) return
  perCtx.delete(token)
  const keys = [...batch.waiters.keys()]
  const rootDef = getModelDefinitionOrThrow(batch.root)
  try {
    const totals = new Map<unknown, number>()
    const add = (k: unknown, n: number) => totals.set(k, (totals.get(k) ?? 0) + n)

    for (const p of batch.paths) {
      if ('column' in p) {
        const col = columnFor(rootDef, p.column).columnName
        for (const [k, n] of await baseOf(batch).groupedCountByFk(col, keys)) add(k, n)
      } else {
        const {viaByKey, allVia} = await gatherLinks(batch, p, keys)
        if (allVia.size > 0) {
          const toCol = columnFor(rootDef, p.to).columnName
          const viaCounts = await baseOf(batch).groupedCountByFk(toCol, [...allVia])
          for (const [keyVal, vias] of viaByKey) {
            let sum = 0
            for (const via of vias) sum += viaCounts.get(via) ?? 0
            add(keyVal, sum)
          }
        }
      }
    }
    for (const [k, waiters] of batch.waiters) {
      const n = totals.get(k) ?? 0
      for (const w of waiters) w.resolve(n)
    }
  } catch (err) {
    for (const waiters of batch.waiters.values()) for (const w of waiters) w.reject(err)
  }
}

async function flushRows(ctxKey: object, token: string): Promise<void> {
  const perCtx = rowsBatches.get(ctxKey)
  const batch = perCtx?.get(token)
  if (!perCtx || !batch) return
  perCtx.delete(token)
  const keys = [...batch.waiters.keys()]
  const rootDef = getModelDefinitionOrThrow(batch.root)
  const pk = rootDef.columns.find(c => c.primaryKey)?.propertyKey ?? 'id'
  try {
    // key → (pk → row): dedup rows a key matches via more than one path.
    const byKey = new Map<unknown, Map<unknown, any>>()
    const bucket = (k: unknown) => {
      let m = byKey.get(k)
      if (!m) byKey.set(k, (m = new Map()))
      return m
    }
    for (const p of batch.paths) {
      if ('column' in p) {
        const col = columnFor(rootDef, p.column).columnName
        const m = await baseOf(batch).groupedRowsByFk(col, keys)
        for (const [k, rows] of m) {
          const bk = bucket(k)
          for (const r of rows) bk.set((r as any)[pk], r)
        }
      } else {
        const {viaByKey, allVia} = await gatherLinks(batch, p, keys)
        if (allVia.size > 0) {
          const toCol = columnFor(rootDef, p.to).columnName
          const rowsByVia = await baseOf(batch).groupedRowsByFk(toCol, [...allVia])
          for (const [keyVal, vias] of viaByKey) {
            const bk = bucket(keyVal)
            for (const via of vias) for (const r of rowsByVia.get(via) ?? []) bk.set((r as any)[pk], r)
          }
        }
      }
    }
    for (const [k, waiters] of batch.waiters) {
      const rows = [...(byKey.get(k)?.values() ?? [])]
      for (const w of waiters) w.resolve(rows)
    }
  } catch (err) {
    for (const waiters of batch.waiters.values()) for (const w of waiters) w.reject(err)
  }
}

/** Through path: fetch the (via → key) links once (scoped). Shared by count + rows. */
async function gatherLinks(
  batch: Batch<any>,
  p: Extract<KeyProjection<any>, {through: unknown}>,
  keys: unknown[]
): Promise<{viaByKey: Map<unknown, unknown[]>; allVia: Set<unknown>}> {
  let tq = new QuerySet(p.through).filter({
    [p.key]: {in: keys},
    ...(p.where ?? {})
  } as WhereInput<any>)
  if (batch.unscoped) tq = tq.unscoped()
  const links = (await tq.all()) as Array<Record<string, unknown>>
  const viaByKey = new Map<unknown, unknown[]>()
  const allVia = new Set<unknown>()
  for (const row of links) {
    const keyVal = row[p.key]
    const viaVal = row[p.on]
    allVia.add(viaVal)
    const list = viaByKey.get(keyVal) ?? []
    list.push(viaVal)
    viaByKey.set(keyVal, list)
  }
  return {viaByKey, allVia}
}

// ── Phase 2: the batchKey() marker + predicate deriver ──────────────────────
// Instead of hand-writing `paths`, mark the key in a natural WhereInput and let the
// engine read the projections off the predicate. A marked-but-unbatchable predicate
// THROWS (§10 contract) — it never silently degrades to N+1.

const BATCH_KEY = Symbol('pylon-db.batchKey')

/** Mark a value as the batch key. Returns the value under a Symbol brand (invisible
 *  to JSON / enumeration, unmistakable to the deriver); typed as the value so
 *  WhereInput typing is unaffected. */
export function batchKey<T>(value: T): T {
  return {[BATCH_KEY]: value} as unknown as T
}

class BatchKeyError extends Error {
  constructor(msg: string) {
    super(`batchKey(): ${msg}`)
    this.name = 'BatchKeyError'
  }
}

function marked(x: unknown): {value: unknown} | undefined {
  return x !== null && typeof x === 'object' && BATCH_KEY in (x as object)
    ? {value: (x as Record<symbol, unknown>)[BATCH_KEY]}
    : undefined
}
function hasMarker(x: unknown): boolean {
  if (marked(x)) return true
  if (Array.isArray(x)) return x.some(hasMarker)
  if (x && typeof x === 'object') return Object.values(x as object).some(hasMarker)
  return false
}
function isColumn(def: ModelDefinition, prop: string): boolean {
  return def.columns.some(c => c.propertyKey === prop)
}

interface DerivedPlan {
  key: unknown
  where: WhereInput<any>
  paths: KeyProjection<any>[]
}

/**
 * Walk a merged WhereInput; split into the shared (key-free) predicate + the paths
 * that carry the key. Returns null when there is no marker (→ caller runs a plain
 * count). Throws BatchKeyError on a marked predicate the engine can't batch.
 */
function deriveKeyedPlan(rootDef: ModelDefinition, fragments: WhereInput<any>[]): DerivedPlan | null {
  if (!fragments.some(hasMarker)) return null

  const paths: KeyProjection<any>[] = []
  const shared: Record<string, unknown> = {}
  const keyBox: {value: unknown; set: boolean} = {value: undefined, set: false}
  const setKey = (v: unknown) => {
    if (keyBox.set && keyBox.value !== v)
      throw new BatchKeyError('must denote a single dimension; found multiple values.')
    keyBox.value = v
    keyBox.set = true
  }

  for (const frag of fragments) {
    for (const [k, v] of Object.entries(frag as Record<string, unknown>)) {
      if (k === 'OR') {
        if (!Array.isArray(v)) throw new BatchKeyError('OR must be an array.')
        for (const branch of v) paths.push(deriveBranch(rootDef, branch, setKey))
      } else if (k === 'AND' || k === 'NOT') {
        if (hasMarker(v)) throw new BatchKeyError(`cannot sit under ${k}.`)
        shared[k] = v
      } else if (hasMarker(v)) {
        paths.push(deriveBranch(rootDef, {[k]: v}, setKey))
      } else {
        shared[k] = v
      }
    }
  }
  if (!keyBox.set) throw new BatchKeyError('marker present but no key value resolved.')
  return {key: keyBox.value, where: shared as WhereInput<any>, paths}
}

/** A single key-bearing branch → one KeyProjection. Supports `{column: batchKey()}`
 *  and the one-hop `{belongsTo: {hasMany: {some: {keyCol: batchKey(), …}}}}` through. */
function deriveBranch(
  rootDef: ModelDefinition,
  branch: unknown,
  setKey: (v: unknown) => void
): KeyProjection<any> {
  const entries = Object.entries(branch as Record<string, unknown>)
  if (entries.length !== 1)
    throw new BatchKeyError('a key branch must be a single {column: …} or {relation: …}.')
  const [k, v] = entries[0]

  // {column: batchKey(v)}
  const m = marked(v)
  if (m) {
    if (!isColumn(rootDef, k))
      throw new BatchKeyError(`'${k}' is not a column of ${rootDef.tableName} (must be an equality on a column).`)
    setKey(m.value)
    return {column: k}
  }

  // A marker nested inside a comparator/object on a real column
  // (e.g. `{ createdAt: { gt: batchKey() } }`) — must be a direct equality.
  if (isColumn(rootDef, k))
    throw new BatchKeyError(
      `on column '${k}' must be a direct equality ({ ${k}: batchKey(x) }), not nested in a comparator/object.`
    )

  // {belongsTo: {hasMany: {some: {keyCol: batchKey(v), …rest}}}}
  const belongsTo = rootDef.relations.find(r => r.propertyKey === k && r.kind === 'belongsTo')
  if (!belongsTo)
    throw new BatchKeyError(
      `through '${k}': only a belongsTo → hasMany → some path is supported (v1). ` +
        `Use an equality on a column, or the explicit keyedQuery({paths}) form.`
    )
  const midDef = getModelDefinitionOrThrow(belongsTo.target() as ModelCtor<any>)
  const midEntries = Object.entries((v ?? {}) as Record<string, unknown>)
  if (midEntries.length !== 1)
    throw new BatchKeyError(`through '${k}': expected a single { <hasMany>: { some: … } }.`)
  const [relName, relVal] = midEntries[0]
  const hasMany = midDef.relations.find(r => r.propertyKey === relName && r.kind === 'hasMany')
  if (!hasMany)
    throw new BatchKeyError(`through '${k}.${relName}': not a hasMany on ${midDef.tableName}.`)
  const some = (relVal as {some?: unknown} | null)?.some
  if (!some || typeof some !== 'object')
    throw new BatchKeyError(`through '${k}.${relName}': expected { some: … }.`)

  let keyCol: string | undefined
  const rest: Record<string, unknown> = {}
  for (const [sk, sv] of Object.entries(some as Record<string, unknown>)) {
    const sm = marked(sv)
    if (sm) {
      if (keyCol) throw new BatchKeyError(`through '${k}.${relName}.some': multiple keys.`)
      keyCol = sk
      setKey(sm.value)
    } else rest[sk] = sv
  }
  if (!keyCol) throw new BatchKeyError(`through '${k}.${relName}.some': no batchKey().`)

  return {
    through: hasMany.target() as ModelCtor<any>,
    on: hasMany.targetForeignKey!, // e.g. Affiliation.personId
    to: belongsTo.fkProperty!, // e.g. Ticket.contactId
    key: keyCol, // e.g. Affiliation.companyId
    where: Object.keys(rest).length ? (rest as WhereInput<any>) : undefined
  }
}

/**
 * If `whereFragments` carry a batchKey() marker, derive the plan and return the keyed
 * terminal object (`.count()/.exists()/.all()/.first()`); else null so the caller runs
 * plain. Wired into `QuerySet`. Throws BatchKeyError on a marked-but-unbatchable
 * predicate (§10) — never a silent N+1.
 */
export function keyedTerminalFor(
  root: ModelCtor<any>,
  whereFragments: WhereInput<any>[],
  unscoped: boolean
): KeyedTerminal | null {
  const plan = deriveKeyedPlan(getModelDefinitionOrThrow(root), whereFragments)
  if (!plan) return null
  return keyedQuery(root, {key: plan.key, where: plan.where, paths: plan.paths, unscoped})
}
