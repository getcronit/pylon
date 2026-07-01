import {joinColumn, joinTableName} from '@getcronit/pylon-ir'
import {Database, getDatabase} from './database.js'
import {
  type BulkOptions,
  columnFor,
  type Connection,
  createManager,
  createMany,
  applyPolicyWhere,
  applyTenantWhere,
  decodeCursor,
  deleteManyInstances,
  encodeCursor,
  hydrate,
  ModelCtor,
  type PaginateArgs,
  QuerySet,
  selectableColumns,
  type WhereInput
} from './manager.js'
import {appContextKey} from './app-context.js'
import {getModelDefinitionOrThrow, type ModelDefinition} from './registry.js'
import {parseSearchQuery} from './query-parser.js'

/** Return type of a `belongsTo` accessor. */
export type Relation<T> = Promise<T | null>

interface Paginatable<T extends object> {
  paginate(args: PaginateArgs): Promise<Connection<T>>
}

/**
 * Wrap a relation manager so the accessor is BOTH callable and a manager: calling
 * it (`post.tags(first, after, last, before)`) returns a `Connection` page — which
 * is what the GraphQL layer does for a paginated relation field — while property
 * access (`post.tags.add(...)`, `.all()`, `await post.tags`) still reaches the
 * underlying manager. A `Proxy` over the paginate call: invoking runs the target
 * (paginate); every other member forwards to the manager (bound).
 */
export function asPaginated<T extends object, M extends Paginatable<T>>(
  mgr: M,
  def?: ModelDefinition
): M {
  const call = (
    first?: number,
    after?: string,
    last?: number,
    before?: string,
    skip?: number,
    query?: string
  ) => {
    const args = {first, after, last, before, skip}
    // Shopify-style `query` string → WhereInput, applied before paging. Needs the
    // target model def (for field/type coercion) and a `.filter()` on the manager
    // (RelatedManager has one; managers without it don't expose `query`).
    if (query && def) {
      const where = parseSearchQuery(query, def) as unknown as WhereInput<T>
      const m = mgr as unknown as {filter?: (w: WhereInput<T>) => Paginatable<T>}
      if (Object.keys(where).length && typeof m.filter === 'function') {
        return m.filter(where).paginate(args)
      }
    }
    return mgr.paginate(args)
  }
  return new Proxy(call, {
    get(target, prop, receiver) {
      // Manager members win (add/all/paginate/then/…). Anything the manager does
      // NOT define falls back to the function target — so `bind`/`call`/`apply`/
      // `name`/`length` keep working (the GraphQL layer does `accessor.bind(row)`).
      const v = (mgr as any)[prop]
      if (v !== undefined) return typeof v === 'function' ? v.bind(mgr) : v
      return Reflect.get(target, prop, receiver)
    }
  }) as unknown as M
}

interface Waiter<R> {
  resolve: (value: R | null) => void
  reject: (error: unknown) => void
}

interface Batch {
  tableName: string
  pkColumn: string
  target: ModelCtor<any>
  /** FK value → waiters requesting the related row for that value. */
  waiters: Map<unknown, Waiter<any>[]>
  scheduled: boolean
}

/**
 * Per-REQUEST, per-target batches. Many `belongsTo` accesses in the same
 * microtask collapse into a single `WHERE pk IN (...)` query — the N+1
 * elimination seam, working underneath the GraphQL array resolution path. Keyed
 * by the ambient app-context (not the connection): the connection is shared
 * across concurrent requests, but each request has its own context — so two
 * requests with different principals never share a batch (and thus never mix
 * each other's row-level policy).
 */
const belongsToBatches = new WeakMap<object, Map<string, Batch>>()

/** Load a single related instance by foreign-key value, batched per microtask. */
export function loadBelongsTo<R extends object>(
  target: ModelCtor<R>,
  fkValue: unknown
): Promise<R | null> {
  const db = getDatabase()
  const def = getModelDefinitionOrThrow(target)
  const pk = def.primaryKey
  if (!pk) {
    throw new Error(
      `Cannot resolve relation: "${def.tableName}" has no primary key.`
    )
  }

  const ctxKey = appContextKey()
  const token = `${def.tableName}.${pk.columnName}`
  let perCtx = belongsToBatches.get(ctxKey)
  if (!perCtx) {
    perCtx = new Map()
    belongsToBatches.set(ctxKey, perCtx)
  }
  let batch = perCtx.get(token)
  if (!batch) {
    batch = {
      tableName: def.tableName,
      pkColumn: pk.columnName,
      target,
      waiters: new Map(),
      scheduled: false
    }
    perCtx.set(token, batch)
  }

  const b = batch
  return new Promise<R | null>((resolve, reject) => {
    const list = b.waiters.get(fkValue) ?? []
    list.push({resolve, reject})
    b.waiters.set(fkValue, list)
    if (!b.scheduled) {
      b.scheduled = true
      queueMicrotask(() => {
        void flush(db, ctxKey, token)
      })
    }
  })
}

async function flush(db: Database, ctxKey: object, token: string): Promise<void> {
  const perCtx = belongsToBatches.get(ctxKey)
  const batch = perCtx?.get(token)
  if (!perCtx || !batch) return
  // Drop the batch before awaiting so accesses on the next tick start fresh.
  perCtx.delete(token)

  const targetDef = getModelDefinitionOrThrow(batch.target)
  const keys = [...batch.waiters.keys()]
  try {
    // A relation read re-applies the target's READ policy AND its TENANT scope —
    // traversal can't surface a row you couldn't have queried directly (incl. one
    // in another tenant).
    const rows = await applyTenantWhere(
      applyPolicyWhere(
        db.kysely
          .selectFrom(batch.tableName)
          .select(selectableColumns(targetDef))
          .where(batch.pkColumn as any, 'in', keys as any),
        targetDef,
        'read'
      ),
      targetDef
    ).execute()

    const byKey = new Map<unknown, any>()
    for (const row of rows) byKey.set((row as any)[batch.pkColumn], row)

    for (const [key, waiters] of batch.waiters) {
      const row = byKey.get(key)
      const instance = row ? hydrate(batch.target, row) : null
      for (const w of waiters) w.resolve(instance)
    }
  } catch (err) {
    for (const waiters of batch.waiters.values()) {
      for (const w of waiters) w.reject(err)
    }
  }
}

/** A resolved relation default ordering: column name + direction. */
export interface RelationOrder {
  column: string
  dir: 'asc' | 'desc'
}

interface HasManyBatch {
  childTable: string
  fkColumn: string
  child: ModelCtor<any>
  /** Default ordering for this relation's batched query, if declared. */
  order?: RelationOrder
  /** Parent PK value → waiters wanting that parent's children. */
  waiters: Map<unknown, Array<{resolve: (rows: any[]) => void; reject: (e: unknown) => void}>>
  scheduled: boolean
}

// Per-REQUEST, per-(childTable.fkColumn) batches: many `parent.children.all()`
// accesses in one microtask collapse into a single `WHERE fk IN (…)` and are
// grouped back by FK. The read-side twin of the belongsTo batcher — it makes a
// nested list field (`authors { posts { … } }`) resolve in one query per level
// instead of one per parent. Keyed by the ambient app-context (see belongsTo)
// so concurrent requests never share a batch.
const hasManyBatches = new WeakMap<object, Map<string, HasManyBatch>>()

/** Load a parent's `hasMany` children by FK value, batched per microtask. */
function loadHasMany<T extends object>(
  child: ModelCtor<T>,
  fkColumn: string,
  parentValue: unknown,
  order?: RelationOrder
): Promise<T[]> {
  const db = getDatabase()
  const def = getModelDefinitionOrThrow(child)
  const ctxKey = appContextKey()
  // The order is part of the batch identity: two relations to the same child via
  // the same FK but different default orderings must not collapse into one query.
  const token = order
    ? `${def.tableName}.${fkColumn}#${order.column} ${order.dir}`
    : `${def.tableName}.${fkColumn}`
  let perCtx = hasManyBatches.get(ctxKey)
  if (!perCtx) {
    perCtx = new Map()
    hasManyBatches.set(ctxKey, perCtx)
  }
  let batch = perCtx.get(token)
  if (!batch) {
    batch = {childTable: def.tableName, fkColumn, child, order, waiters: new Map(), scheduled: false}
    perCtx.set(token, batch)
  }

  const b = batch
  return new Promise<T[]>((resolve, reject) => {
    const list = b.waiters.get(parentValue) ?? []
    list.push({resolve, reject})
    b.waiters.set(parentValue, list)
    if (!b.scheduled) {
      b.scheduled = true
      queueMicrotask(() => void flushHasMany(db, ctxKey, token))
    }
  })
}

/**
 * Load a parent's single `hasOne` child (the inverse of a unique-FK belongsTo),
 * batched per microtask via the same path as `hasMany` — returns the first row or
 * null. A 1:1's FK + unique constraint guarantees at most one.
 */
export function loadHasOne<T extends object>(
  child: ModelCtor<T>,
  fkColumn: string,
  parentValue: unknown
): Promise<T | null> {
  return loadHasMany(child, fkColumn, parentValue).then(rows => (rows[0] as T) ?? null)
}

async function flushHasMany(db: Database, ctxKey: object, token: string): Promise<void> {
  const perCtx = hasManyBatches.get(ctxKey)
  const batch = perCtx?.get(token)
  if (!perCtx || !batch) return
  perCtx.delete(token)

  const childDef = getModelDefinitionOrThrow(batch.child)
  const keys = [...batch.waiters.keys()]
  try {
    // Children are re-scoped by the child model's READ policy AND its TENANT scope
    // (a relation read is scoped exactly like a direct query — no cross-tenant leak).
    let query = db.kysely
      .selectFrom(batch.childTable)
      .select(selectableColumns(childDef))
      .where(batch.fkColumn as any, 'in', keys as any)
    // One global ORDER BY over the batched rows: grouping by FK below iterates in
    // result order, so each parent's list inherits this ordering (no per-parent
    // query needed). The batch token keys on the order, so groups never mix.
    if (batch.order) {
      query = query.orderBy(batch.order.column as any, batch.order.dir)
    }
    const rows = await applyTenantWhere(
      applyPolicyWhere(query, childDef, 'read'),
      childDef
    ).execute()

    // Group rows by their FK value → each parent gets its own list.
    const byKey = new Map<unknown, any[]>()
    for (const row of rows) {
      const k = (row as any)[batch.fkColumn]
      const list = byKey.get(k) ?? []
      list.push(row)
      byKey.set(k, list)
    }

    for (const [key, waiters] of batch.waiters) {
      const instances = (byKey.get(key) ?? []).map(r => hydrate(batch.child, r))
      for (const w of waiters) w.resolve(instances)
    }
  } catch (err) {
    for (const waiters of batch.waiters.values()) {
      for (const w of waiters) w.reject(err)
    }
  }
}

// ── Batched relation counts ─────────────────────────────────────────────────
// The aggregate twin of the hasMany batcher: N parents doing
// `children[.filter(P)].count()` in one microtask collapse into a single
// `SELECT fk, count(*) WHERE fk IN (…) AND P GROUP BY fk`. Keyed on the child
// table + fk column + the (canonicalised) predicate P + scope, so only callers
// with the SAME predicate share a batch. A predicate-free `.count()` is the P = ∅
// case. Per-parent orderBy/limit (top-N) is NOT covered — that needs a window
// function; count/exists/existence don't.
interface CountBatch {
  child: ModelCtor<any>
  fkColumn: string
  where: WhereInput<any>[]
  unscoped: boolean
  waiters: Map<unknown, Array<{resolve: (n: number) => void; reject: (e: unknown) => void}>>
  scheduled: boolean
}
const countBatches = new WeakMap<object, Map<string, CountBatch>>()

// Stable serialisation of the predicate list for the batch token (object keys
// sorted, so equivalent filters share a batch; a mismatch only costs a missed
// coalesce, never correctness).
function canonicalWhere(where: WhereInput<any>[]): string {
  const norm = (v: any): any =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])]))
      : v
  return JSON.stringify(where.map(norm))
}

/** Enqueue a batched relation count; resolves with THIS parent's count. */
function batchedRelationCount<T extends object>(
  child: ModelCtor<T>,
  fkColumn: string,
  fkValue: unknown,
  where: WhereInput<T>[],
  unscoped: boolean
): Promise<number> {
  const def = getModelDefinitionOrThrow(child)
  const ctxKey = appContextKey()
  const token = `${def.tableName}.${fkColumn}${unscoped ? '!u' : ''}?${canonicalWhere(where)}`
  let perCtx = countBatches.get(ctxKey)
  if (!perCtx) {
    perCtx = new Map()
    countBatches.set(ctxKey, perCtx)
  }
  let batch = perCtx.get(token)
  if (!batch) {
    batch = {child, fkColumn, where, unscoped, waiters: new Map(), scheduled: false}
    perCtx.set(token, batch)
  }
  const b = batch
  return new Promise<number>((resolve, reject) => {
    const list = b.waiters.get(fkValue) ?? []
    list.push({resolve, reject})
    b.waiters.set(fkValue, list)
    if (!b.scheduled) {
      b.scheduled = true
      queueMicrotask(() => void flushCountBatch(ctxKey, token))
    }
  })
}

async function flushCountBatch(ctxKey: object, token: string): Promise<void> {
  const perCtx = countBatches.get(ctxKey)
  const batch = perCtx?.get(token)
  if (!perCtx || !batch) return
  perCtx.delete(token)
  const keys = [...batch.waiters.keys()]
  try {
    let qs = new QuerySet(batch.child)
    for (const w of batch.where) qs = qs.filter(w)
    if (batch.unscoped) qs = qs.unscoped()
    const counts = await qs.groupedCountByFk(batch.fkColumn, keys)
    for (const [key, waiters] of batch.waiters) {
      const n = counts.get(key) ?? 0
      for (const w of waiters) w.resolve(n)
    }
  } catch (err) {
    for (const waiters of batch.waiters.values()) {
      for (const w of waiters) w.reject(err)
    }
  }
}

// A relation-derived filtered query (from `parent.children.filter(P)`). Extends
// QuerySet so every op (all/first/update/delete/search/…) behaves exactly as
// before; ONLY count()/exists() are overridden to BATCH across parents. A further
// `.filter()` chains via the inherited QuerySet (un-batched) — the single-filter
// case, which is the common one, is what batches.
export class RelatedQuerySet<T extends object> extends QuerySet<T> {
  constructor(
    private readonly relChild: ModelCtor<T>,
    fkProperty: string,
    private readonly relFkColumn: string,
    private readonly relFkValue: unknown,
    private readonly relWhere: WhereInput<T>[]
  ) {
    super(relChild, {
      where: [{[fkProperty]: relFkValue} as WhereInput<T>, ...relWhere],
      raw: [],
      orderBy: []
    })
  }

  count(): Promise<number> {
    return batchedRelationCount(this.relChild, this.relFkColumn, this.relFkValue, this.relWhere, false)
  }

  exists(): Promise<boolean> {
    return this.count().then(n => n > 0)
  }
}

// NOTE: plain `//` comments (not `/** */`) on purpose. A JSDoc block here is
// read by Pylon's schema builder as the GraphQL *description* of the derived
// list element type, leaking ORM internals into the user's schema.
//
// Type-only merge: a `RelatedManager<T>` also presents as `T[]`. This makes
// Pylon's build-time schema introspection treat a `hasMany` field as a GraphQL
// list (`[T]`) — its `isList` check keys on the `Array` base type — while the
// runtime value stays a chainable, thenable manager. The inherited array
// methods (`map`, `length`, …) are typed but never materialize at runtime;
// resolve the list with `await user.posts` (or `.all()`) instead.
export interface RelatedManager<T extends object> extends Array<T> {}

// A reverse (`hasMany`) accessor. Pre-scoped to the parent's foreign key, it is
// both chainable (`user.posts.filter(...).all()`) and thenable
// (`await user.posts`), and can create children with the FK pre-filled.
export class RelatedManager<T extends object> {
  private readonly base: QuerySet<T>

  constructor(
    private readonly ctor: ModelCtor<T>,
    private readonly fkProperty: string,
    private readonly fkValue: unknown,
    /** Declared default ordering (property name, optional `-` prefix = desc). */
    private readonly orderProperty?: string
  ) {
    this.base = new QuerySet(ctor).filter({
      [fkProperty]: fkValue
    } as WhereInput<T>)
  }

  // The first overload is the ORM query filter; the second exists only to stay
  // structurally compatible with the merged `Array<T>.filter` (it is never used
  // at runtime).
  filter(where: WhereInput<T>): RelatedQuerySet<T>
  filter(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: any
  ): T[]
  filter(conditions: any): RelatedQuerySet<T> | T[] {
    // A batch-aware queryset: `.count()`/`.exists()` collapse across parents; all
    // other ops behave like the plain QuerySet this used to return.
    return new RelatedQuerySet(this.ctor, this.fkProperty, this.fkColumn, this.fkValue, [conditions])
  }

  orderBy(field: keyof T | `-${string & keyof T}`): QuerySet<T> {
    return this.base.orderBy(field)
  }

  limit(n: number): QuerySet<T> {
    return this.base.limit(n)
  }

  /** The DB column the FK property maps to (e.g. `authorId` → `author_id`). */
  private get fkColumn(): string {
    const def = getModelDefinitionOrThrow(this.ctor)
    return def.columns.find(c => c.propertyKey === this.fkProperty)?.columnName ?? this.fkProperty
  }

  /** Resolve the declared default ordering to a column + direction (or none). */
  private get order(): RelationOrder | undefined {
    if (!this.orderProperty) return undefined
    const desc = this.orderProperty.startsWith('-')
    const prop = desc ? this.orderProperty.slice(1) : this.orderProperty
    const def = getModelDefinitionOrThrow(this.ctor)
    const column = def.columns.find(c => c.propertyKey === prop)?.columnName ?? prop
    return {column, dir: desc ? 'desc' : 'asc'}
  }

  /**
   * Resolve all children. **Batched** across the microtask: N parents resolving
   * the same relation collapse into one `WHERE fk IN (…)` (no N+1). For a
   * filtered/ordered/limited subset, chain off the manager (`posts.filter(…)`),
   * which returns a plain `QuerySet` (a distinct, un-batched query).
   */
  all(): Promise<T[]> {
    return loadHasMany(this.ctor, this.fkColumn, this.fkValue, this.order)
  }

  first(): Promise<T | null> {
    return this.base.first()
  }

  get(conditions?: WhereInput<T>): Promise<T> {
    return this.base.get(conditions)
  }

  count(): Promise<number> {
    // Batched across parents (P = ∅). `.filter(P).count()` batches with the predicate.
    return batchedRelationCount(this.ctor, this.fkColumn, this.fkValue, [], false)
  }

  /**
   * Relay cursor pagination over this parent's children — the scoped twin of
   * `Manager.paginate`. Keyset over the child table (single table, the FK filter
   * is already applied), so it reuses `QuerySet.paginate` directly. NOTE: unlike
   * `.all()`, a paginated relation is NOT N+1-batched — each parent's page is its
   * own keyset query (inherent to cursor pagination; fine for detail views).
   */
  paginate(args?: PaginateArgs): Promise<Connection<T>> {
    return this.base.paginate(args)
  }

  /** Create a child row with the parent foreign key already set. */
  create(values: Partial<T>): Promise<T> {
    return createManager(this.ctor).create({
      ...values,
      [this.fkProperty]: this.fkValue
    } as Partial<T>)
  }

  private withFk(values: Partial<T>): Partial<T> {
    return {...values, [this.fkProperty]: this.fkValue} as Partial<T>
  }

  /** Create many child rows in one round-trip, FK pre-filled (see Manager.createMany). */
  createMany(values: Partial<T>[], options?: BulkOptions): Promise<T[]> {
    return createMany(this.ctor, values.map(v => this.withFk(v)), options)
  }

  /**
   * Replace the entire child set: delete the current children, then bulk-create
   * the given ones — in a few queries regardless of count. Signal-aware by
   * default (`preDelete`/`postDelete` + `preSave`/`postSave` each fire once with
   * the affected array); `{signals: false}` uses a raw bulk delete for speed.
   */
  async set(values: Partial<T>[], options: BulkOptions = {}): Promise<T[]> {
    // Atomic delete-then-recreate (reentrant — joins an ambient transaction): a
    // failure mid-replace can't leave the old children deleted but not replaced.
    return getDatabase().transaction(async () => {
      if (options.signals === false) {
        await this.base.delete()
      } else {
        await deleteManyInstances(await this.base.all(), options)
      }
      return this.createMany(values, options)
    })
  }

  /** Thenable: `await user.posts` resolves to the full list (batched). */
  then<R1 = T[], R2 = never>(
    onfulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.all().then(onfulfilled, onrejected)
  }
}

// Type-only merge so a `manyToMany` field presents as a GraphQL list (`[T]`),
// mirroring `RelatedManager`. The runtime value is a join-table-backed manager.
export interface ManyToManyManager<T extends object> extends Array<T> {}

/**
 * A `manyToMany` accessor, scoped to the owning row's primary key. Reads resolve
 * through the synthesized join table (`await post.tags` / `.all()`); writes mutate
 * only the join table (`.add()`, `.remove()`, `.set()`, `.clear()`), never the
 * target rows. The join-table name + columns are derived lazily (so forward
 * references resolve) and deterministically, so both relation sides agree.
 */
export interface ManyToManyBinding {
  through?: string
  sourceColumn?: string
  targetColumn?: string
}

/** A target row to link/unlink: a full instance, a `{id}` object, or the bare
 *  primary-key value (link ops only need the PK). */
export type Linkable<T> =
  | T
  | (T extends {id: infer I} ? Exclude<I, null> : string | number)

export class ManyToManyManager<T extends object> {
  private readonly through?: string
  private readonly sourceColumn?: string
  private readonly targetColumn?: string

  constructor(
    private readonly ownerCtor: ModelCtor<any>,
    private readonly targetCtor: ModelCtor<T>,
    private readonly ownerPk: unknown,
    binding: ManyToManyBinding = {}
  ) {
    this.through = binding.through
    this.sourceColumn = binding.sourceColumn
    this.targetColumn = binding.targetColumn
  }

  private spec() {
    const ownerDef = getModelDefinitionOrThrow(this.ownerCtor)
    const targetDef = getModelDefinitionOrThrow(this.targetCtor)
    const ownerPk = ownerDef.primaryKey
    const targetPk = targetDef.primaryKey
    if (!ownerPk || !targetPk) {
      throw new Error(
        `Cannot resolve manyToMany between "${ownerDef.tableName}" and "${targetDef.tableName}": both need a primary key.`
      )
    }
    const joinTable = joinTableName(
      ownerDef.tableName,
      targetDef.tableName,
      this.through
    )
    return {
      joinTable,
      localColumn:
        this.sourceColumn ?? joinColumn(ownerDef.tableName, ownerPk.columnName),
      targetColumn:
        this.targetColumn ?? joinColumn(targetDef.tableName, targetPk.columnName),
      targetTable: targetDef.tableName,
      targetPkColumn: targetPk.columnName,
      targetPkProperty: targetPk.propertyKey
    }
  }

  // Link ops only need the target's PRIMARY KEY (they write join rows, never the
  // target table), so accept the bare key, a `{id}` object, or a full instance —
  // a scalar is the key itself; an object yields its PK property.
  private keyOf(item: Linkable<T>, prop: string): unknown {
    return typeof item === 'object' && item !== null ? (item as any)[prop] : item
  }

  /** All related rows, via a join (re-scoped by the target's READ policy). */
  async all(): Promise<T[]> {
    const s = this.spec()
    const targetDef = getModelDefinitionOrThrow(this.targetCtor)
    const rows = await applyPolicyWhere(
      getDatabase()
        .kysely.selectFrom(s.targetTable)
        .innerJoin(
          s.joinTable,
          `${s.joinTable}.${s.targetColumn}` as any,
          `${s.targetTable}.${s.targetPkColumn}` as any
        )
        .where(`${s.joinTable}.${s.localColumn}` as any, '=', this.ownerPk as any)
        .select(selectableColumns(targetDef, s.targetTable) as any),
      targetDef,
      'read',
      s.targetTable
    ).execute()
    return rows.map(r => hydrate(this.targetCtor, r))
  }

  async count(): Promise<number> {
    const s = this.spec()
    const row = await getDatabase()
      .kysely.selectFrom(s.joinTable)
      .select(eb => eb.fn.countAll().as('count'))
      .where(s.localColumn as any, '=', this.ownerPk as any)
      .executeTakeFirst()
    return Number((row as any)?.count ?? 0)
  }

  /**
   * Relay cursor pagination over the related rows, THROUGH the join table. Keyset
   * on a stable target column (the target PK by default), re-scoped by the
   * target's READ policy — the paginated twin of `.all()`. `QuerySet.paginate`
   * can't be reused here (it's single-table); this mirrors its keyset logic over
   * the join. Like the hasMany case, a paginated relation is NOT N+1-batched.
   */
  async paginate(args: PaginateArgs = {}): Promise<Connection<T>> {
    const s = this.spec()
    const targetDef = getModelDefinitionOrThrow(this.targetCtor)
    const raw = args.orderBy ?? targetDef.primaryKey?.propertyKey
    if (!raw) {
      throw new Error(`${targetDef.tableName}: .paginate() needs an orderBy or a primary key.`)
    }
    const desc = raw.startsWith('-')
    const orderCol = columnFor(targetDef, desc ? raw.slice(1) : raw).columnName
    const qualified = `${s.targetTable}.${orderCol}`

    // Backward paging walks the reverse order then flips back (mirrors QuerySet).
    const backward = args.last !== undefined || args.before !== undefined
    const size = (backward ? args.last : args.first) ?? 20
    const naturalAsc = !desc
    const orderDir = backward ? (naturalAsc ? 'desc' : 'asc') : naturalAsc ? 'asc' : 'desc'

    let q: any = getDatabase()
      .kysely.selectFrom(s.targetTable)
      .innerJoin(
        s.joinTable,
        `${s.joinTable}.${s.targetColumn}` as any,
        `${s.targetTable}.${s.targetPkColumn}` as any
      )
      .where(`${s.joinTable}.${s.localColumn}` as any, '=', this.ownerPk as any)
      .select(selectableColumns(targetDef, s.targetTable) as any)
    q = applyPolicyWhere(q, targetDef, 'read', s.targetTable)
    if (!backward && args.after !== undefined) {
      q = q.where(qualified as any, desc ? '<' : '>', decodeCursor(args.after) as any)
    }
    if (backward && args.before !== undefined) {
      q = q.where(qualified as any, desc ? '>' : '<', decodeCursor(args.before) as any)
    }
    q = q.orderBy(qualified as any, orderDir)
    if (!backward && args.skip) q = q.offset(args.skip)

    const fetched = await q.limit(size + 1).execute()
    const hasExtra = fetched.length > size
    let page = hasExtra ? fetched.slice(0, size) : fetched
    if (backward) page = page.reverse()

    // Rows are aliased to short column names (see selectableColumns), so the
    // cursor reads the unqualified order column.
    const edges = page.map((r: any) => ({
      cursor: encodeCursor(r[orderCol]),
      node: hydrate(this.targetCtor, r)
    }))
    return {
      edges,
      nodes: edges.map(e => e.node),
      totalCount: await this.count(),
      pageInfo: {
        hasNextPage: backward ? args.before !== undefined : hasExtra,
        hasPreviousPage: backward ? hasExtra : args.after !== undefined || (args.skip ?? 0) > 0,
        startCursor: edges.length ? edges[0].cursor : null,
        endCursor: edges.length ? edges[edges.length - 1].cursor : null
      }
    }
  }

  /** Link one or more rows by instance OR primary key (idempotent). */
  async add(...items: Array<Linkable<T>>): Promise<void> {
    if (!items.length) return
    const s = this.spec()
    const values = items.map(i => ({
      [s.localColumn]: this.ownerPk,
      [s.targetColumn]: this.keyOf(i, s.targetPkProperty)
    }))
    await getDatabase()
      .kysely.insertInto(s.joinTable)
      .values(values as any)
      .onConflict(oc => oc.columns([s.localColumn, s.targetColumn]).doNothing())
      .execute()
  }

  /** Unlink one or more rows by instance OR primary key (target rows untouched). */
  async remove(...items: Array<Linkable<T>>): Promise<void> {
    if (!items.length) return
    const s = this.spec()
    await getDatabase()
      .kysely.deleteFrom(s.joinTable)
      .where(s.localColumn as any, '=', this.ownerPk as any)
      .where(
        s.targetColumn as any,
        'in',
        items.map(i => this.keyOf(i, s.targetPkProperty)) as any
      )
      .execute()
  }

  /** Drop every link for this row. */
  async clear(): Promise<void> {
    const s = this.spec()
    await getDatabase()
      .kysely.deleteFrom(s.joinTable)
      .where(s.localColumn as any, '=', this.ownerPk as any)
      .execute()
  }

  /** Replace the full link set (by instance OR primary key) in one transaction. */
  async set(items: Array<Linkable<T>>): Promise<void> {
    await getDatabase().transaction(async () => {
      await this.clear()
      await this.add(...items)
    })
  }

  /** Thenable: `await post.tags` resolves to the full list. */
  then<R1 = T[], R2 = never>(
    onfulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.all().then(onfulfilled, onrejected)
  }
}
