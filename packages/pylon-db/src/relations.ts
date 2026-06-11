import {joinColumn, joinTableName} from '@getcronit/pylon-ir'
import {Database, getDatabase} from './database.js'
import {
  type BulkOptions,
  createManager,
  createMany,
  deleteManyInstances,
  hydrate,
  ModelCtor,
  QuerySet
} from './manager.js'
import {getModelDefinitionOrThrow} from './registry.js'

/** Return type of a `belongsTo` accessor. */
export type Relation<T> = Promise<T | null>

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
 * Per-database, per-target batches. Many `belongsTo` accesses in the same
 * microtask collapse into a single `WHERE pk IN (...)` query — this is the N+1
 * elimination seam, and it works underneath the GraphQL array resolution path.
 */
const batchesByDb = new WeakMap<Database, Map<string, Batch>>()

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

  const token = `${def.tableName}.${pk.columnName}`
  let perDb = batchesByDb.get(db)
  if (!perDb) {
    perDb = new Map()
    batchesByDb.set(db, perDb)
  }
  let batch = perDb.get(token)
  if (!batch) {
    batch = {
      tableName: def.tableName,
      pkColumn: pk.columnName,
      target,
      waiters: new Map(),
      scheduled: false
    }
    perDb.set(token, batch)
  }

  const b = batch
  return new Promise<R | null>((resolve, reject) => {
    const list = b.waiters.get(fkValue) ?? []
    list.push({resolve, reject})
    b.waiters.set(fkValue, list)
    if (!b.scheduled) {
      b.scheduled = true
      queueMicrotask(() => {
        void flush(db, token)
      })
    }
  })
}

async function flush(db: Database, token: string): Promise<void> {
  const perDb = batchesByDb.get(db)
  if (!perDb) return
  const batch = perDb.get(token)
  if (!batch) return
  // Drop the batch before awaiting so accesses on the next tick start fresh.
  perDb.delete(token)

  const keys = [...batch.waiters.keys()]
  try {
    const rows = await db.kysely
      .selectFrom(batch.tableName)
      .selectAll()
      .where(batch.pkColumn as any, 'in', keys as any)
      .execute()

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
    private readonly fkValue: unknown
  ) {
    this.base = new QuerySet(ctor).filter({
      [fkProperty]: fkValue
    } as Partial<Record<keyof T, unknown>>)
  }

  // The first overload is the ORM query filter; the second exists only to stay
  // structurally compatible with the merged `Array<T>.filter` (it is never used
  // at runtime).
  filter(conditions: Partial<Record<keyof T, unknown>>): QuerySet<T>
  filter(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: any
  ): T[]
  filter(conditions: any): QuerySet<T> | T[] {
    return this.base.filter(conditions)
  }

  orderBy(field: keyof T | `-${string & keyof T}`): QuerySet<T> {
    return this.base.orderBy(field)
  }

  limit(n: number): QuerySet<T> {
    return this.base.limit(n)
  }

  all(): Promise<T[]> {
    return this.base.all()
  }

  first(): Promise<T | null> {
    return this.base.first()
  }

  get(conditions?: Partial<Record<keyof T, unknown>>): Promise<T> {
    return this.base.get(conditions)
  }

  count(): Promise<number> {
    return this.base.count()
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
    if (options.signals === false) {
      await this.base.delete()
    } else {
      await deleteManyInstances(await this.base.all(), options)
    }
    return this.createMany(values, options)
  }

  /** Thenable: `await user.posts` resolves to the full list. */
  then<R1 = T[], R2 = never>(
    onfulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.base.all().then(onfulfilled, onrejected)
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

  private targetPkValue(instance: T, prop: string): unknown {
    return (instance as any)[prop]
  }

  /** All related rows, via a join. */
  async all(): Promise<T[]> {
    const s = this.spec()
    const rows = await getDatabase()
      .kysely.selectFrom(s.targetTable)
      .innerJoin(
        s.joinTable,
        `${s.joinTable}.${s.targetColumn}` as any,
        `${s.targetTable}.${s.targetPkColumn}` as any
      )
      .where(`${s.joinTable}.${s.localColumn}` as any, '=', this.ownerPk as any)
      .selectAll(s.targetTable)
      .execute()
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

  /** Link one or more rows (idempotent — duplicate links are ignored). */
  async add(...instances: T[]): Promise<void> {
    if (!instances.length) return
    const s = this.spec()
    const values = instances.map(i => ({
      [s.localColumn]: this.ownerPk,
      [s.targetColumn]: this.targetPkValue(i, s.targetPkProperty)
    }))
    await getDatabase()
      .kysely.insertInto(s.joinTable)
      .values(values as any)
      .onConflict(oc => oc.columns([s.localColumn, s.targetColumn]).doNothing())
      .execute()
  }

  /** Unlink one or more rows (the target rows themselves are untouched). */
  async remove(...instances: T[]): Promise<void> {
    if (!instances.length) return
    const s = this.spec()
    await getDatabase()
      .kysely.deleteFrom(s.joinTable)
      .where(s.localColumn as any, '=', this.ownerPk as any)
      .where(
        s.targetColumn as any,
        'in',
        instances.map(i => this.targetPkValue(i, s.targetPkProperty)) as any
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

  /** Replace the full link set in a single transaction. */
  async set(instances: T[]): Promise<void> {
    await getDatabase().transaction(async () => {
      await this.clear()
      await this.add(...instances)
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
