import {currentTenant} from './app-context.js'
import {getDatabase} from './database.js'
import {signals} from './signals.js'
import {
  ColumnDefinition,
  getModelDefinitionOrThrow,
  ModelDefinition
} from './registry.js'
import {ValidationError, validateInstance} from './validation.js'

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

// ── Relay-style cursor pagination ───────────────────────────────────────────
export interface PageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor: string | null
  endCursor: string | null
}

/** A Relay edge: a node paired with its cursor. */
export interface Edge<T> {
  cursor: string
  node: T
}

export interface Connection<T> {
  /** Relay edges (node + cursor). Mirrors `nodes` for clients that want either. */
  edges: Edge<T>[]
  nodes: T[]
  pageInfo: PageInfo
  /** Total rows matching the filter (ignores the cursor window). */
  totalCount: number
}

export interface PaginateArgs {
  /** Forward page size (default 20). */
  first?: number
  /** Forward cursor: start after this one. */
  after?: string
  /** Backward page size — the last N before `before`. */
  last?: number
  /** Backward cursor: end before this one. */
  before?: string
  /** Offset fallback (forward only), applied before the limit. */
  skip?: number
  /** Field to order + key on; `-` prefix for descending. Defaults to the PK. */
  orderBy?: string
}

/** Keyset cursor = base64url(JSON(orderBy value)). */
function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
function decodeCursor(cursor: string): unknown {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
}

interface QueryState {
  where: Condition[]
  orderBy: {column: string; dir: 'asc' | 'desc'}[]
  limit?: number
  /** Skip tenant auto-scoping for this query (cross-tenant / admin). */
  unscoped?: boolean
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
      limit: patch.limit ?? this.state.limit,
      unscoped: patch.unscoped ?? this.state.unscoped
    })
  }

  /** Bypass tenant auto-scoping (cross-tenant / admin queries). */
  unscoped(): QuerySet<T> {
    return this.clone({unscoped: true})
  }

  /** The tenant filter for this query (none if unscoped / not a tenant model). */
  private tenantConditions(): Condition[] {
    const column = this.def.tenantColumn
    if (!column || this.state.unscoped) return []
    const tenant = currentTenant()
    if (tenant === undefined || tenant === null) {
      throw new Error(
        `Model "${this.def.tableName}" is tenant-scoped but no tenant is bound. ` +
          `Bind one via useDatabase({tenant}) / the queue runtime, or use .unscoped().`
      )
    }
    return [{column, value: tenant}]
  }

  /** Explicit filters + the implicit tenant filter. */
  private allConditions(): Condition[] {
    return [...this.state.where, ...this.tenantConditions()]
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
    for (const cond of this.allConditions()) {
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
    for (const cond of this.allConditions()) {
      q =
        cond.value === null
          ? q.where(cond.column, 'is', null)
          : q.where(cond.column, '=', cond.value as any)
    }
    const row = await q.executeTakeFirstOrThrow()
    return Number((row as any).count)
  }

  /** Delete every row matching the current filter. Returns the count deleted. */
  async delete(): Promise<number> {
    const db = getDatabase()
    let q = db.kysely.deleteFrom(this.def.tableName)
    for (const cond of this.allConditions()) {
      q =
        cond.value === null
          ? q.where(cond.column, 'is', null)
          : q.where(cond.column, '=', cond.value as any)
    }
    const res = await q.executeTakeFirst()
    return Number(res?.numDeletedRows ?? 0)
  }

  /**
   * Relay-style cursor pagination (keyset on a stable, unique `orderBy` — the PK
   * by default). Returns `{edges, nodes, pageInfo, totalCount}`, respecting the
   * current filters + tenant scope. Supports forward (`first`/`after`, plus an
   * `skip` offset) and backward (`last`/`before`) paging; an extra row is
   * over-fetched to detect the next/previous page.
   */
  async paginate(args: PaginateArgs = {}): Promise<Connection<T>> {
    const raw = args.orderBy ?? this.def.primaryKey?.propertyKey
    if (!raw) {
      throw new Error(`${this.def.tableName}: .paginate() needs an orderBy or a primary key.`)
    }
    const desc = raw.startsWith('-')
    const col = columnFor(this.def, desc ? raw.slice(1) : raw).columnName

    // Backward paging walks the reverse of the natural order, then flips back.
    const backward = args.last !== undefined || args.before !== undefined
    const size = (backward ? args.last : args.first) ?? 20
    const naturalAsc = !desc
    const orderDir = backward
      ? naturalAsc
        ? 'desc'
        : 'asc'
      : naturalAsc
        ? 'asc'
        : 'desc'

    const db = getDatabase()
    let q = db.kysely.selectFrom(this.def.tableName).selectAll()
    for (const cond of this.allConditions()) {
      q = cond.value === null ? q.where(cond.column, 'is', null) : q.where(cond.column, '=', cond.value as any)
    }
    if (!backward && args.after !== undefined) {
      q = q.where(col, desc ? '<' : '>', decodeCursor(args.after) as any)
    }
    if (backward && args.before !== undefined) {
      q = q.where(col, desc ? '>' : '<', decodeCursor(args.before) as any)
    }
    q = q.orderBy(col as any, orderDir)
    if (!backward && args.skip) q = q.offset(args.skip)

    const fetched = await q.limit(size + 1).execute()
    const hasExtra = fetched.length > size
    let page = hasExtra ? fetched.slice(0, size) : fetched
    if (backward) page = page.reverse() // restore natural order

    const cursorOf = (r: any) => encodeCursor(r[col])
    const edges = page.map(r => ({cursor: cursorOf(r), node: hydrate(this.ctor, r)}))
    return {
      edges,
      nodes: edges.map(e => e.node),
      totalCount: await this.count(), // filters + tenant, no cursor window
      pageInfo: {
        hasNextPage: backward ? args.before !== undefined : hasExtra,
        hasPreviousPage: backward
          ? hasExtra
          : args.after !== undefined || (args.skip ?? 0) > 0,
        startCursor: edges.length ? edges[0].cursor : null,
        endCursor: edges.length ? edges[edges.length - 1].cursor : null
      }
    }
  }

  /** Update every row matching the current filter with `values`. */
  async update(values: Partial<Record<keyof T, unknown>>): Promise<number> {
    const db = getDatabase()
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      data[columnFor(this.def, key).columnName] = value
    }
    let q = db.kysely.updateTable(this.def.tableName).set(data)
    for (const cond of this.allConditions()) {
      q =
        cond.value === null
          ? q.where(cond.column, 'is', null)
          : q.where(cond.column, '=', cond.value as any)
    }
    const res = await q.executeTakeFirst()
    return Number(res?.numUpdatedRows ?? 0)
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

  /** Bypass tenant auto-scoping (cross-tenant / admin queries). */
  unscoped(): QuerySet<T> {
    return this.qs().unscoped()
  }

  paginate(args?: PaginateArgs): Promise<Connection<T>> {
    return this.qs().paginate(args)
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

  // Tenant auto-scope on create: stamp the tenant column from the ambient tenant
  // when not set explicitly. Existing rows keep their tenant; an explicit value
  // (admin/cross-tenant create) is respected.
  if (!persisted.has(instance) && def.tenantColumn) {
    const tcol = def.columns.find(c => c.columnName === def.tenantColumn)
    if (tcol) {
      const current = (instance as any)[tcol.propertyKey]
      if (current === undefined || current === null) {
        const tenant = currentTenant()
        if (tenant === undefined || tenant === null) {
          throw new Error(
            `Cannot create "${def.tableName}": tenant-scoped but no tenant bound and ` +
              `"${tcol.propertyKey}" was not provided.`
          )
        }
        ;(instance as any)[tcol.propertyKey] = tenant
      }
    }
  }

  // Client-side default generators (e.g. cuid/uuid ids) resolve on create when
  // no value was provided. Runs before validation so a generated NOT NULL PK
  // satisfies its constraint.
  if (!persisted.has(instance)) {
    for (const col of def.columns) {
      if (!col.defaultFn) continue
      const cur = (instance as any)[col.propertyKey]
      if (cur === undefined || cur === null) {
        ;(instance as any)[col.propertyKey] = col.defaultFn()
      }
    }
  }

  // Validate before touching the DB — fail fast with structured, translatable
  // issues instead of a raw Postgres constraint error.
  const issues = validateInstance(def, instance)
  if (issues.length > 0) throw new ValidationError(issues)

  const db = getDatabase()
  const pk = def.primaryKey
  const created = !(persisted.has(instance) && pk)
  const model = instance.constructor as Function

  // `@updatedAt`: stamp on every UPDATE. On INSERT the `now()` server default
  // applies (the column is left unset → DB fills it), keeping one source.
  if (!created) {
    for (const col of def.columns) {
      if (col.onUpdateNow) (instance as any)[col.propertyKey] = new Date()
    }
  }

  await signals.preSave.emit({instance, created, model})

  if (!created) {
    const data = rowFromInstance(def, instance, {includePrimaryKey: false})
    await db.kysely
      .updateTable(def.tableName)
      .set(data)
      .where(pk!.columnName, '=', (instance as any)[pk!.propertyKey])
      .execute()
  } else {
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
  }

  await signals.postSave.emit({instance, created, model})
  return instance
}

export async function deleteInstance(instance: object): Promise<void> {
  const def = getModelDefinitionOrThrow(instance.constructor)
  const pk = def.primaryKey
  if (!pk) {
    throw new Error(`Cannot delete "${def.tableName}": no primary key defined.`)
  }
  const db = getDatabase()
  const model = instance.constructor as Function
  await signals.preDelete.emit({instance, model})
  await db.kysely
    .deleteFrom(def.tableName)
    .where(pk.columnName, '=', (instance as any)[pk.propertyKey])
    .execute()
  persisted.delete(instance)
  await signals.postDelete.emit({instance, model})
}
