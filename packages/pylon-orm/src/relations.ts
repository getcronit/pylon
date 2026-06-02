import {Database, getDatabase} from './database.js'
import {createManager, hydrate, ModelCtor, QuerySet} from './manager.js'
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

/**
 * A reverse (`hasMany`) accessor. Pre-scoped to the parent's foreign key, it is
 * both chainable (`user.posts.filter(...).all()`) and thenable
 * (`await user.posts`), and can create children with the FK pre-filled.
 */
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

  filter(conditions: Partial<Record<keyof T, unknown>>): QuerySet<T> {
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

  /** Thenable: `await user.posts` resolves to the full list. */
  then<R1 = T[], R2 = never>(
    onfulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.base.all().then(onfulfilled, onrejected)
  }
}
