import {joinColumn, joinTableName} from '../ir'
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
  type Edge,
  encodeCursor,
  hydrate,
  ModelCtor,
  type PageInfo,
  type PaginateArgs,
  QuerySet,
  selectableColumns,
  type WhereInput
} from './manager.js'
import {appContextKey} from './app-context.js'
import {batchLoad, createRealm} from './batch-loader.js'
import {foreignKeyViolation} from './errors.js'
import {keyedQuery} from './keyed-query.js'
import {noteQuery} from './n-plus-one.js'
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

/**
 * Load a single related instance by foreign-key value, batched per microtask: many
 * `belongsTo` accesses in one tick collapse to a single `WHERE pk IN (…)`. Re-applies
 * the target's READ policy + TENANT scope (traversal can't surface a row you couldn't
 * query directly, incl. one in another tenant). Coalescing via the shared batch-loader.
 */
const belongsToRealm = createRealm<unknown, any>()

export function loadBelongsTo<R extends object>(
  target: ModelCtor<R>,
  fkValue: unknown
): Promise<R | null> {
  const def = getModelDefinitionOrThrow(target)
  const pk = def.primaryKey
  if (!pk) {
    throw new Error(`Cannot resolve relation: "${def.tableName}" has no primary key.`)
  }
  const pkCol = pk.columnName
  return batchLoad<unknown, R | null>(
    belongsToRealm,
    `${def.tableName}.${pkCol}`,
    fkValue,
    async keys => {
      const db = getDatabase()
      const rows = await applyTenantWhere(
        applyPolicyWhere(
          db.kysely
            .selectFrom(def.tableName)
            .select(selectableColumns(def))
            .where(pkCol as any, 'in', keys as any),
          def,
          'read'
        ),
        def
      ).execute()
      const byKey = new Map<unknown, R>()
      for (const row of rows) byKey.set((row as any)[pkCol], hydrate(target, row))
      return byKey
    },
    () => null
  )
}

/** A resolved relation default ordering: column name + direction. */
export interface RelationOrder {
  column: string
  dir: 'asc' | 'desc'
}

// Load a parent's `hasMany` children by FK value, batched per microtask: many
// `parent.children.all()` accesses in one tick collapse into a single `WHERE fk IN
// (…)` with a global ORDER BY, grouped back by FK (each parent's list inherits the
// order). Re-scoped by the child's READ policy + TENANT. Coalescing via the shared
// batch-loader; the order is part of the token so different orderings don't mix.
const hasManyRealm = createRealm<unknown, any[]>()

function loadHasMany<T extends object>(
  child: ModelCtor<T>,
  fkColumn: string,
  parentValue: unknown,
  order?: RelationOrder
): Promise<T[]> {
  const def = getModelDefinitionOrThrow(child)
  const token = order
    ? `${def.tableName}.${fkColumn}#${order.column} ${order.dir}`
    : `${def.tableName}.${fkColumn}`
  return batchLoad<unknown, T[]>(
    hasManyRealm,
    token,
    parentValue,
    async keys => {
      const db = getDatabase()
      let query = db.kysely
        .selectFrom(def.tableName)
        .select(selectableColumns(def))
        .where(fkColumn as any, 'in', keys as any)
      if (order) query = query.orderBy(order.column as any, order.dir)
      const rows = await applyTenantWhere(applyPolicyWhere(query, def, 'read'), def).execute()
      const byKey = new Map<unknown, T[]>()
      for (const row of rows) {
        const k = (row as any)[fkColumn]
        const list = byKey.get(k) ?? []
        list.push(hydrate(child, row))
        byKey.set(k, list)
      }
      return byKey
    },
    () => []
  )
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

// The join-table twin of loadHasMany: batches `owner.related.all()` across a tick.
// Many owners in one tick collapse into ONE `SELECT target.*, join.local FROM target
// JOIN join WHERE join.local IN (…)`, grouped back by owner. Re-scoped by the target's
// READ policy (mirrors the single-owner .all()). Coalesced via the shared loader.
interface M2MSpec {
  joinTable: string
  localColumn: string
  targetColumn: string
  targetTable: string
  targetPkColumn: string
}

const manyToManyRealm = createRealm<unknown, any[]>()

function loadManyToMany<T extends object>(
  targetCtor: ModelCtor<T>,
  s: M2MSpec,
  ownerPk: unknown
): Promise<T[]> {
  const targetDef = getModelDefinitionOrThrow(targetCtor)
  const token = `${s.joinTable}:${s.localColumn}->${s.targetTable}`
  return batchLoad<unknown, T[]>(
    manyToManyRealm,
    token,
    ownerPk,
    async keys => {
      const rows = await applyPolicyWhere(
        getDatabase()
          .kysely.selectFrom(s.targetTable)
          .innerJoin(
            s.joinTable,
            `${s.joinTable}.${s.targetColumn}` as any,
            `${s.targetTable}.${s.targetPkColumn}` as any
          )
          .where(`${s.joinTable}.${s.localColumn}` as any, 'in', keys as any)
          .select(selectableColumns(targetDef, s.targetTable) as any)
          .select(`${s.joinTable}.${s.localColumn} as __m2m_local` as any),
        targetDef,
        'read',
        s.targetTable
      ).execute()
      const byKey = new Map<unknown, T[]>()
      for (const row of rows) {
        const {__m2m_local: k, ...rest} = row as any
        const list = byKey.get(k) ?? []
        list.push(hydrate(targetCtor, rest))
        byKey.set(k, list)
      }
      return byKey
    },
    () => []
  )
}

// The grouped-count twin: `SELECT local, count(*) FROM join WHERE local IN (…) GROUP
// BY local`. Counts join rows (matches the single-owner `.count()` — no target policy).
const manyToManyCountRealm = createRealm<unknown, number>()

function countManyToMany(s: M2MSpec, ownerPk: unknown): Promise<number> {
  const token = `${s.joinTable}:${s.localColumn}#count`
  return batchLoad<unknown, number>(
    manyToManyCountRealm,
    token,
    ownerPk,
    async keys => {
      const rows = await getDatabase()
        .kysely.selectFrom(s.joinTable)
        .select(eb => [eb.ref(s.localColumn).as('k'), eb.fn.countAll().as('n')])
        .where(s.localColumn as any, 'in', keys as any)
        .groupBy(s.localColumn as any)
        .execute()
      const m = new Map<unknown, number>()
      for (const r of rows) m.set((r as any).k, Number((r as any).n))
      return m
    },
    () => 0
  )
}

// A relation-derived filtered query (from `parent.children.filter(P)`). Extends
// QuerySet so every op (all/first/update/delete/search/…) behaves exactly as before;
// ONLY count()/exists() are overridden to BATCH across parents — routed through the
// keyed-query engine as one column path (the FK) + the shared predicate P, so the
// relation count-batcher is just the engine's simplest case. A further `.filter()`
// chains via the inherited QuerySet (un-batched); single-filter is the common case.
export class RelatedQuerySet<T extends object> extends QuerySet<T> {
  constructor(
    private readonly relChild: ModelCtor<T>,
    private readonly relFkProperty: string,
    _relFkColumn: string, // retained for the constructor shape; count routes by property
    private readonly relFkValue: unknown,
    private readonly relWhere: WhereInput<T>[],
    /** The relation's declared default ordering — so a FILTERED page keeps it. */
    private readonly relOrderProperty?: string
  ) {
    super(relChild, {
      where: [{[relFkProperty]: relFkValue} as WhereInput<T>, ...relWhere],
      raw: [],
      orderBy: []
    })
  }

  /**
   * Default the keyset order to the relation's DECLARED `orderBy` (mirroring the
   * unfiltered `RelatedManager.paginate`). Without this, a `query`-filtered relation
   * connection — `post.comments(query: …)`, the Shopify-DSL path in `asPaginated` —
   * falls through to `QuerySet.paginate`'s PK default and loses its chronological
   * order. An explicit `args.orderBy` still wins.
   */
  paginate(args: PaginateArgs = {}): Promise<Connection<T>> {
    const orderBy = args.orderBy ?? this.relOrderProperty
    return super.paginate(orderBy ? {...args, orderBy} : args)
  }

  private keyed() {
    const where =
      this.relWhere.length === 0
        ? undefined
        : this.relWhere.length === 1
          ? this.relWhere[0]
          : ({AND: this.relWhere} as WhereInput<T>)
    return keyedQuery(this.relChild, {
      key: this.relFkValue,
      where,
      paths: [{column: this.relFkProperty as keyof T & string}]
    })
  }

  count(): Promise<number> {
    return this.keyed().count()
  }

  exists(): Promise<boolean> {
    return this.keyed().exists()
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
    // other ops behave like the plain QuerySet this used to return. The declared
    // order rides along so a filtered `.paginate()` keeps it (see RelatedQuerySet).
    return new RelatedQuerySet(this.ctor, this.fkProperty, this.fkColumn, this.fkValue, [conditions], this.orderProperty)
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
    // The relation count-batcher is the engine's simplest case: one column path (the
    // FK), no shared predicate. `.filter(P).count()` (RelatedQuerySet) adds P.
    return keyedQuery(this.ctor, {
      key: this.fkValue,
      paths: [{column: this.fkProperty as keyof T & string}]
    }).count()
  }

  /**
   * Relay cursor pagination over this parent's children — the scoped twin of
   * `Manager.paginate`. Keyset over the child table (single table, the FK filter
   * is already applied), so it reuses `QuerySet.paginate` directly. NOTE: unlike
   * `.all()`, a paginated relation is NOT N+1-batched — each parent's page is its
   * own keyset query (inherent to cursor pagination; fine for detail views).
   */
  paginate(args?: PaginateArgs): Promise<Connection<T>> {
    // Default the keyset order to the relation's DECLARED `orderBy` (as `.all()` does),
    // so a paginated connection is chronological/declared-ordered rather than PK order.
    // An explicit `args.orderBy` (incl. a composite array) still wins.
    const orderBy = args?.orderBy ?? this.orderProperty
    return this.base.paginate(orderBy ? {...args, orderBy} : args)
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
  // a scalar is the key itself; an object yields its PK property. (Gids are
  // decoded at the GraphQL `ID` scalar boundary, so a raw local id arrives here.)
  private keyOf(item: Linkable<T>, prop: string): unknown {
    return typeof item === 'object' && item !== null ? (item as any)[prop] : item
  }

  /** All related rows, via a join (re-scoped by the target's READ policy). */
  // Batched across a tick (loadManyToMany) → `owner.related.all()` over a whole list
  // collapses to ONE join query, so it's no longer an N+1.
  all(): Promise<T[]> {
    return loadManyToMany(this.targetCtor, this.spec(), this.ownerPk)
  }

  // Batched grouped count (countManyToMany) — the twin of `.all()`.
  count(): Promise<number> {
    return countManyToMany(this.spec(), this.ownerPk)
  }

  /**
   * Relay cursor pagination over the related rows, THROUGH the join table. Keyset
   * on a stable target column (the target PK by default), re-scoped by the
   * target's READ policy — the paginated twin of `.all()`. `QuerySet.paginate`
   * can't be reused here (it's single-table); this mirrors its keyset logic over
   * the join. Like the hasMany case, a paginated relation is NOT N+1-batched.
   */
  async paginate(args: PaginateArgs = {}): Promise<Connection<T>> {
    noteQuery(this.targetCtor, 'paginate') // paginated relation isn't batched → advisory
    const s = this.spec()
    const targetDef = getModelDefinitionOrThrow(this.targetCtor)
    if (Array.isArray(args.orderBy)) {
      throw new Error(
        `${targetDef.tableName}: composite orderBy is not supported on relation pagination.`
      )
    }
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
      // Through-relation connections don't resolve `anchor` (rare deep-link target);
      // startIndex still reflects an explicit forward `skip` so the field is total.
      startIndex: backward ? 0 : args.skip ?? 0,
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
    try {
      await getDatabase()
        .kysely.insertInto(s.joinTable)
        .values(values as any)
        .onConflict(oc => oc.columns([s.localColumn, s.targetColumn]).doNothing())
        .execute()
    } catch (err) {
      // A join-row insert can only fail its FKs two ways: the owner row or a target row
      // doesn't exist. Turn Postgres's opaque `violates foreign key constraint "<hash>"`
      // into a message that names the missing side + id (see `foreignKeyViolation`).
      const ownerName = this.ownerCtor.name
      const targetName = this.targetCtor.name
      throw (
        foreignKeyViolation(err, {
          action: `link ${ownerName} ↔ ${targetName}`,
          columns: {[s.localColumn]: ownerName, [s.targetColumn]: targetName}
        }) ?? err
      )
    }
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

// ── hasManyThrough ─────────────────────────────────────────────────────────────
// A read-only accessor that hops TWO existing relations — `owner[through]` (a
// hasMany bridge) then `intermediate[via]` (a hasMany or manyToMany to the target)
// — to reach a grandchild set. Django's `related__name` lookups / Rails'
// `has_many :through`, expressed as a relation *chain*: no denormalized key, no
// migration — it walks the FKs that already exist. Every terminal batches across a
// request tick (many owners → a handful of grouped queries, never N+1), so the
// list badge (`totalCount`) collapses; `.paginate()` windows in memory per owner.

/** Type-only merge so a non-paginated `hasManyThrough` presents as a GraphQL list. */
export interface HasManyThroughManager<T extends object> extends Array<T> {}

export interface HasManyThroughBinding {
  /** The INTERMEDIATE model (thunk — e.g. `() => TicketMessage`). */
  through: () => ModelCtor<any>
  /** FK property on the intermediate pointing back to the owner (e.g. `ticketId`).
   *  Optional — auto-detected from the intermediate's belongsTo to the owner. */
  foreignKey?: string
  /** hasMany | manyToMany relation on the INTERMEDIATE reaching the target
   *  (e.g. `TicketMessage.comments`). */
  via: string
  /** Default target ordering (property, `-`-prefixed = desc). Applied to lists + pages. */
  orderBy?: string
  /** Static scope predicate ANDed onto the target (e.g. `{deletedAt: null}`). */
  where?: WhereInput<any>
}

/** The resolved two-hop plan (owner → intermediate → target), derived from the
 *  registry at call time so forward references resolve. */
interface ThroughPlan {
  interCtor: ModelCtor<any>
  interPkColumn: string
  /** Intermediate FK column back to the owner (the batch key — e.g. `ticket_id`). */
  interKeyColumn: string
  target: ModelCtor<any>
  targetPkProperty: string
  orderColumn?: string
  orderDir: 'asc' | 'desc'
  where?: WhereInput<any>
  via:
    | {kind: 'hasMany'; fkColumn: string}
    | {kind: 'manyToMany'; joinTable: string; localColumn: string; targetColumn: string}
}

// One realm per terminal so a count-only read (the list badge) never materializes
// rows for the hasMany-via case. Both are keyed by the owner PK, coalesced per tick.
const throughCountRealm = createRealm<unknown, number>()
const throughRowsRealm = createRealm<unknown, any[]>()


export class HasManyThroughManager<T extends object> {
  constructor(
    private readonly ownerCtor: ModelCtor<any>,
    private readonly ownerPk: unknown,
    private readonly targetCtor: ModelCtor<T>,
    private readonly binding: HasManyThroughBinding
  ) {}

  /** Resolve the owner→intermediate→target chain off the registry (call-time, so
   *  lazy targets are registered). Throws a precise error on a misdeclared chain. */
  private plan(): ThroughPlan {
    const ownerDef = getModelDefinitionOrThrow(this.ownerCtor)
    const label = `hasManyThrough on ${ownerDef.tableName}`
    const interCtor = this.binding.through() as ModelCtor<any>
    const interDef = getModelDefinitionOrThrow(interCtor)
    const interPk = interDef.primaryKey
    if (!interPk) throw new Error(`${label}: intermediate "${interDef.tableName}" has no primary key.`)

    // The intermediate's FK back to the owner. Explicit when given; otherwise the sole
    // `belongsTo` on the intermediate whose target IS this owner (ambiguity → ask).
    let fkProperty = this.binding.foreignKey
    if (fkProperty) {
      if (!interDef.columns.some(c => c.propertyKey === fkProperty)) {
        throw new Error(
          `${label}: foreignKey "${fkProperty}" is not a column of intermediate "${interDef.tableName}".`
        )
      }
    } else {
      const backs = interDef.relations.filter(
        r => r.kind === 'belongsTo' && r.target() === this.ownerCtor
      )
      if (backs.length !== 1) {
        throw new Error(
          `${label}: could not auto-detect the FK from "${interDef.tableName}" back to ` +
            `"${ownerDef.tableName}" (${backs.length} candidates) — pass an explicit foreignKey.`
        )
      }
      fkProperty = backs[0].fkProperty!
    }

    const via = interDef.relations.find(r => r.propertyKey === this.binding.via)
    if (!via) {
      throw new Error(
        `${label}: via "${this.binding.via}" is not a relation on ${interDef.tableName}.`
      )
    }
    const target = via.target() as ModelCtor<any>
    const targetDef = getModelDefinitionOrThrow(target)
    const targetPk = targetDef.primaryKey
    if (!targetPk) throw new Error(`${label}: target "${targetDef.tableName}" has no primary key.`)

    let viaSpec: ThroughPlan['via']
    if (via.kind === 'hasMany') {
      viaSpec = {kind: 'hasMany', fkColumn: columnFor(targetDef, via.targetForeignKey!).columnName}
    } else if (via.kind === 'manyToMany') {
      viaSpec = {
        kind: 'manyToMany',
        joinTable: joinTableName(interDef.tableName, targetDef.tableName, via.through),
        localColumn: via.sourceColumn ?? joinColumn(interDef.tableName, interPk.columnName),
        targetColumn: via.targetColumn ?? joinColumn(targetDef.tableName, targetPk.columnName)
      }
    } else {
      throw new Error(
        `${label}: via "${this.binding.via}" must be a hasMany or manyToMany (got ${via.kind}).`
      )
    }

    const rawOrder = this.binding.orderBy
    const desc = rawOrder?.startsWith('-') ?? false
    const orderProp = rawOrder ? (desc ? rawOrder.slice(1) : rawOrder) : undefined
    return {
      interCtor,
      interPkColumn: interPk.columnName,
      interKeyColumn: columnFor(interDef, fkProperty).columnName,
      target,
      targetPkProperty: targetPk.propertyKey,
      orderColumn: orderProp,
      orderDir: desc ? 'desc' : 'asc',
      where: this.binding.where,
      via: viaSpec
    }
  }

  private targetQS(p: ThroughPlan): QuerySet<T> {
    const qs = new QuerySet(p.target as ModelCtor<T>)
    return p.where ? qs.filter(p.where as WhereInput<T>) : qs
  }

  /** intermediate PKs grouped by owner PK (scoped) + the flat set of all inter PKs. */
  private async bridgeIds(
    p: ThroughPlan,
    ownerPks: unknown[]
  ): Promise<{byOwner: Map<unknown, unknown[]>; all: unknown[]}> {
    const byOwner = await new QuerySet(p.interCtor).groupedIdsByFk(
      p.interKeyColumn,
      p.interPkColumn,
      ownerPks
    )
    const all = [...new Set([...byOwner.values()].flat())]
    return {byOwner, all}
  }

  /** Batched grouped counts, owner PK → count. hasMany-via stays a pure count (no
   *  rows); manyToMany-via reuses the deduped row gather (a target may hang off
   *  several of an owner's intermediates → count DISTINCT). */
  private async gatherCounts(p: ThroughPlan, ownerPks: unknown[]): Promise<Map<unknown, number>> {
    if (p.via.kind === 'manyToMany') {
      const rows = await this.gatherRows(p, ownerPks)
      return new Map([...rows].map(([k, v]) => [k, v.length]))
    }
    const {byOwner, all} = await this.bridgeIds(p, ownerPks)
    const out = new Map<unknown, number>()
    if (!all.length) return out
    const countByInter = await this.targetQS(p).groupedCountByFk(p.via.fkColumn, all)
    for (const [owner, interIds] of byOwner) {
      let n = 0
      for (const iid of interIds) n += countByInter.get(iid) ?? 0
      out.set(owner, n)
    }
    return out
  }

  /** Batched row gather, owner PK → deduped target rows (unsorted; the terminal
   *  sorts). Target scope/tenant/policy + the static `where` apply via `targetQS`. */
  private async gatherRows(p: ThroughPlan, ownerPks: unknown[]): Promise<Map<unknown, T[]>> {
    const {byOwner, all} = await this.bridgeIds(p, ownerPks)
    if (!all.length) return new Map()
    const pk = p.targetPkProperty

    if (p.via.kind === 'hasMany') {
      const rowsByInter = await this.targetQS(p).groupedRowsByFk(p.via.fkColumn, all)
      const out = new Map<unknown, T[]>()
      for (const [owner, interIds] of byOwner) {
        const seen = new Map<unknown, T>()
        for (const iid of interIds)
          for (const r of rowsByInter.get(iid) ?? []) seen.set((r as any)[pk], r)
        out.set(owner, [...seen.values()])
      }
      return out
    }

    // manyToMany-via: pull (intermediate → target) links from the join table, then
    // load the target rows once (SCOPED — the where/tenant/policy decide validity).
    const spec = p.via
    const links = (await getDatabase()
      .kysely.selectFrom(spec.joinTable)
      .select([`${spec.localColumn} as k`, `${spec.targetColumn} as id`] as any)
      .where(spec.localColumn as any, 'in', all as any)
      .execute()) as Array<{k: unknown; id: unknown}>
    const targetIdsByInter = new Map<unknown, unknown[]>()
    const allTargetIds = new Set<unknown>()
    for (const l of links) {
      allTargetIds.add(l.id)
      const list = targetIdsByInter.get(l.k) ?? []
      list.push(l.id)
      targetIdsByInter.set(l.k, list)
    }
    if (!allTargetIds.size) return new Map()
    const rows = await this.targetQS(p)
      .filter({[pk]: {in: [...allTargetIds]}} as WhereInput<T>)
      .all()
    const rowById = new Map<unknown, T>()
    for (const r of rows) rowById.set((r as any)[pk], r)

    const out = new Map<unknown, T[]>()
    for (const [owner, interIds] of byOwner) {
      const seen = new Map<unknown, T>()
      for (const iid of interIds)
        for (const tid of targetIdsByInter.get(iid) ?? []) {
          const r = rowById.get(tid)
          if (r) seen.set(tid, r)
        }
      out.set(owner, [...seen.values()])
    }
    return out
  }

  private sortRows(rows: T[], p: ThroughPlan): T[] {
    if (!p.orderColumn) return rows
    const def = getModelDefinitionOrThrow(p.target)
    const prop = def.columns.find(c => c.columnName === p.orderColumn)?.propertyKey ?? p.orderColumn
    const dir = p.orderDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = (a as any)[prop]
      const bv = (b as any)[prop]
      if (av < bv) return -dir
      if (av > bv) return dir
      return 0
    })
  }

  /** Stable batch token: two owners coalesce iff same owner table + resolved chain
   *  (intermediate + FK column + via) + scope. */
  private token(kind: string, p: ThroughPlan): string {
    const ownerTable = getModelDefinitionOrThrow(this.ownerCtor).tableName
    const inter = getModelDefinitionOrThrow(p.interCtor).tableName
    return (
      `${kind}:${ownerTable}.${inter}(${p.interKeyColumn})->${this.binding.via}` +
      `?w=${JSON.stringify(this.binding.where ?? {})}`
    )
  }

  /** Total across the chain — batched (one grouped count per request tick). */
  count(): Promise<number> {
    const p = this.plan()
    return batchLoad(
      throughCountRealm,
      this.token('count', p),
      this.ownerPk,
      ks => this.gatherCounts(p, ks),
      () => 0
    )
  }

  private rows(p: ThroughPlan): Promise<T[]> {
    return batchLoad(
      throughRowsRealm,
      this.token('rows', p),
      this.ownerPk,
      ks => this.gatherRows(p, ks),
      () => []
    )
  }

  /** All target rows across the chain (batched, deduped, ordered). */
  async all(): Promise<T[]> {
    const p = this.plan()
    return this.sortRows(await this.rows(p), p)
  }

  first(): Promise<T | null> {
    return this.all().then(r => r[0] ?? null)
  }

  /**
   * Relay pagination over the chain. `totalCount` is the batched grouped count;
   * the page windows the owner's ordered rows IN MEMORY (grandchild sets per owner
   * are small). LAZY: `totalCount`/`nodes`/`edges` are getters, so the list badge
   * (`{ comments { totalCount } }`) triggers ONLY the batched count — never a
   * per-owner page query. Cursors key on the target PK (stable, opaque to clients).
   */
  paginate(args: PaginateArgs = {}): Promise<Connection<T>> {
    const p = this.plan()
    const page = async (): Promise<{edges: Edge<T>[]; nodes: T[]; pageInfo: PageInfo}> => {
      const sorted = this.sortRows(await this.rows(p), p)
      return windowInMemory(sorted, args, p.targetPkProperty)
    }
    return Promise.resolve(lazyConnection<T>(() => this.count(), page))
  }

  then<R1 = T[], R2 = never>(
    onfulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.all().then(onfulfilled, onrejected)
  }
}

/**
 * A Connection whose fields resolve LAZILY: `totalCount` runs the (batched) count
 * only if selected; `nodes`/`edges`/`pageInfo` run the page fetch once, shared,
 * only if selected. GraphQL's default resolver reads `source[field]`, so an
 * unselected getter never fires — which is what lets a `totalCount`-only list
 * query batch to a single grouped count instead of a per-row page query.
 */
function lazyConnection<T>(
  totalCount: () => Promise<number>,
  page: () => Promise<{edges: Edge<T>[]; nodes: T[]; pageInfo: PageInfo}>
): Connection<T> {
  let pagePromise: Promise<{edges: Edge<T>[]; nodes: T[]; pageInfo: PageInfo}> | undefined
  const getPage = () => (pagePromise ??= page())
  const conn = {} as Connection<T>
  const def = (name: string, get: () => unknown) =>
    Object.defineProperty(conn, name, {enumerable: true, configurable: true, get})
  def('totalCount', () => totalCount())
  def('nodes', () => getPage().then(p => p.nodes))
  def('edges', () => getPage().then(p => p.edges))
  def('pageInfo', () => getPage().then(p => p.pageInfo))
  return conn
}

/** In-memory Relay window over an already-ordered list; cursors = target PK. */
function windowInMemory<T>(
  sorted: T[],
  args: PaginateArgs,
  pkProperty: string
): {edges: Edge<T>[]; nodes: T[]; pageInfo: PageInfo} {
  const idOf = (r: T) => (r as any)[pkProperty]
  const backward = args.last !== undefined || args.before !== undefined
  const size = (backward ? args.last : args.first) ?? 20

  let lo = 0
  let hi = sorted.length
  if (args.after !== undefined) {
    const c = decodeCursor(args.after)
    const i = sorted.findIndex(r => idOf(r) === c)
    if (i >= 0) lo = i + 1
  }
  if (args.before !== undefined) {
    const c = decodeCursor(args.before)
    const i = sorted.findIndex(r => idOf(r) === c)
    if (i >= 0) hi = i
  }

  let window: T[]
  let hasNextPage: boolean
  let hasPreviousPage: boolean
  if (backward) {
    const start = Math.max(lo, hi - size)
    window = sorted.slice(start, hi)
    hasPreviousPage = start > lo
    hasNextPage = hi < sorted.length
  } else {
    const start = lo + (args.skip ?? 0)
    window = sorted.slice(start, start + size)
    hasNextPage = start + size < hi
    hasPreviousPage = start > 0
  }

  const edges = window.map(r => ({cursor: encodeCursor(idOf(r)), node: r}))
  return {
    edges,
    nodes: window,
    pageInfo: {
      hasNextPage,
      hasPreviousPage,
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null
    }
  }
}
