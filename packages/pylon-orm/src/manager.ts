import {getDatabase} from './database.js'
import {
  ColumnDefinition,
  getModelDefinitionOrThrow,
  ModelDefinition
} from './registry.js'

export type ModelCtor<T> = {new (): T}

/** Tracks which instances came from / have been written to the database. */
const persisted = new WeakSet<object>()

function columnFor(
  def: ModelDefinition,
  propertyKey: string
): ColumnDefinition {
  const col = def.columns.find(c => c.propertyKey === propertyKey)
  if (!col) {
    throw new Error(
      `Unknown field "${propertyKey}" on model "${def.tableName}".`
    )
  }
  return col
}

export function hydrate<T extends object>(ctor: ModelCtor<T>, row: any): T {
  const def = getModelDefinitionOrThrow(ctor)
  const instance = new ctor()
  for (const col of def.columns) {
    if (col.columnName in row) {
      ;(instance as any)[col.propertyKey] = row[col.columnName]
    }
  }
  persisted.add(instance)
  return instance
}

interface Condition {
  column: string
  value: unknown
}

interface QueryState {
  where: Condition[]
  orderBy: {column: string; dir: 'asc' | 'desc'}[]
  limit?: number
}

export class QuerySet<T extends object> {
  constructor(
    private readonly ctor: ModelCtor<T>,
    private readonly state: QueryState = {where: [], orderBy: []}
  ) {}

  private get def(): ModelDefinition {
    return getModelDefinitionOrThrow(this.ctor)
  }

  private clone(patch: Partial<QueryState>): QuerySet<T> {
    return new QuerySet(this.ctor, {
      where: patch.where ?? this.state.where,
      orderBy: patch.orderBy ?? this.state.orderBy,
      limit: patch.limit ?? this.state.limit
    })
  }

  filter(conditions: Partial<Record<keyof T, unknown>>): QuerySet<T> {
    const next = [...this.state.where]
    for (const [key, value] of Object.entries(conditions)) {
      next.push({column: columnFor(this.def, key).columnName, value})
    }
    return this.clone({where: next})
  }

  /** Order by a field; prefix with `-` for descending (e.g. `-createdAt`). */
  orderBy(field: keyof T | `-${string & keyof T}`): QuerySet<T> {
    const raw = String(field)
    const dir: 'asc' | 'desc' = raw.startsWith('-') ? 'desc' : 'asc'
    const propertyKey = raw.startsWith('-') ? raw.slice(1) : raw
    return this.clone({
      orderBy: [
        ...this.state.orderBy,
        {column: columnFor(this.def, propertyKey).columnName, dir}
      ]
    })
  }

  limit(n: number): QuerySet<T> {
    return this.clone({limit: n})
  }

  private build() {
    const db = getDatabase()
    let q = db.kysely.selectFrom(this.def.tableName).selectAll()
    for (const cond of this.state.where) {
      q =
        cond.value === null
          ? q.where(cond.column, 'is', null)
          : q.where(cond.column, '=', cond.value as any)
    }
    for (const o of this.state.orderBy) {
      q = q.orderBy(o.column as any, o.dir)
    }
    if (this.state.limit !== undefined) q = q.limit(this.state.limit)
    return q
  }

  async all(): Promise<T[]> {
    const rows = await this.build().execute()
    return rows.map(r => hydrate(this.ctor, r))
  }

  async first(): Promise<T | null> {
    const rows = await this.limit(1).build().execute()
    return rows.length ? hydrate(this.ctor, rows[0]) : null
  }

  async get(conditions?: Partial<Record<keyof T, unknown>>): Promise<T> {
    const qs = conditions ? this.filter(conditions) : this
    const rows = await qs.limit(2).build().execute()
    if (rows.length === 0) {
      throw new Error(`${this.def.tableName}: no row matched .get()`)
    }
    if (rows.length > 1) {
      throw new Error(`${this.def.tableName}: .get() matched multiple rows`)
    }
    return hydrate(this.ctor, rows[0])
  }

  async count(): Promise<number> {
    const db = getDatabase()
    let q = db.kysely
      .selectFrom(this.def.tableName)
      .select(db.kysely.fn.countAll().as('count'))
    for (const cond of this.state.where) {
      q =
        cond.value === null
          ? q.where(cond.column, 'is', null)
          : q.where(cond.column, '=', cond.value as any)
    }
    const row = await q.executeTakeFirstOrThrow()
    return Number((row as any).count)
  }
}

export class Manager<T extends object> {
  constructor(private readonly ctor: ModelCtor<T>) {}

  private qs(): QuerySet<T> {
    return new QuerySet(this.ctor)
  }

  filter(conditions: Partial<Record<keyof T, unknown>>): QuerySet<T> {
    return this.qs().filter(conditions)
  }

  orderBy(field: keyof T | `-${string & keyof T}`): QuerySet<T> {
    return this.qs().orderBy(field)
  }

  all(): Promise<T[]> {
    return this.qs().all()
  }

  first(): Promise<T | null> {
    return this.qs().first()
  }

  get(conditions?: Partial<Record<keyof T, unknown>>): Promise<T> {
    return this.qs().get(conditions)
  }

  count(): Promise<number> {
    return this.qs().count()
  }

  async create(values: Partial<T>): Promise<T> {
    const instance = new this.ctor()
    Object.assign(instance, values)
    await saveInstance(instance as object)
    return instance
  }
}

export function createManager<T extends object>(
  ctor: ModelCtor<T>
): Manager<T> {
  return new Manager(ctor)
}

function rowFromInstance(
  def: ModelDefinition,
  instance: any,
  {includePrimaryKey}: {includePrimaryKey: boolean}
): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const col of def.columns) {
    if (col.autoIncrement) continue
    if (col.primaryKey && !includePrimaryKey) continue
    const value = instance[col.propertyKey]
    if (value !== undefined) data[col.columnName] = value
  }
  return data
}

export async function saveInstance(instance: object): Promise<object> {
  const def = getModelDefinitionOrThrow(instance.constructor)
  const db = getDatabase()
  const pk = def.primaryKey

  if (persisted.has(instance) && pk) {
    const data = rowFromInstance(def, instance, {includePrimaryKey: false})
    await db.kysely
      .updateTable(def.tableName)
      .set(data)
      .where(pk.columnName, '=', (instance as any)[pk.propertyKey])
      .execute()
    return instance
  }

  const data = rowFromInstance(def, instance, {includePrimaryKey: true})
  const inserted = await db.kysely
    .insertInto(def.tableName)
    .values(data)
    .returningAll()
    .executeTakeFirstOrThrow()

  // Pull back generated values (identity PKs, SQL defaults).
  for (const col of def.columns) {
    if (col.columnName in (inserted as any)) {
      ;(instance as any)[col.propertyKey] = (inserted as any)[col.columnName]
    }
  }
  persisted.add(instance)
  return instance
}

export async function deleteInstance(instance: object): Promise<void> {
  const def = getModelDefinitionOrThrow(instance.constructor)
  const pk = def.primaryKey
  if (!pk) {
    throw new Error(`Cannot delete "${def.tableName}": no primary key defined.`)
  }
  const db = getDatabase()
  await db.kysely
    .deleteFrom(def.tableName)
    .where(pk.columnName, '=', (instance as any)[pk.propertyKey])
    .execute()
  persisted.delete(instance)
}
