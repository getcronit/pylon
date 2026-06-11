import {sql, type Expression, type ExpressionBuilder, type SqlBool} from 'kysely'
import {joinColumn, joinTableName} from '@getcronit/pylon-ir'
import {currentTenant} from './app-context.js'
import {getDatabase} from './database.js'
import {signals} from './signals.js'
import {
  ColumnDefinition,
  getModelDefinitionOrThrow,
  ModelDefinition,
  RelationDefinition
} from './registry.js'
import {ValidationError, uniqueViolation, validateInstance} from './validation.js'
import {NotFoundError} from './errors.js'
// Type-only (erased at runtime → no import cycle with relations.ts) — used to
// exclude relation accessors from the set of filterable fields.
import type {ManyToManyManager, RelatedManager} from './relations.js'

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

/**
 * Assign only DEFINED values onto an instance. An explicit `undefined` means
 * "not provided" (Prisma semantics) — it must NOT clobber a default the model
 * constructor already applied, so it's skipped (≡ omitting the key). `null` is a
 * real value and IS assigned (sets the column null).
 */
function assignDefined<T extends object>(instance: T, values: Partial<T>): void {
  for (const key in values) {
    const v = values[key]
    if (v !== undefined) (instance as any)[key] = v
  }
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

// ── Typed, Prisma-style filtering (WhereInput) ──────────────────────────────
// `.filter()` accepts either the shorthand `{field: value}` (equality) or a
// per-field operator object (`{field: {gt, in, contains, …}}`), plus the logical
// combinators `AND`/`OR`/`NOT`. Operators are typed against each field's real
// type; relation accessors and computed-field methods are excluded.

interface EqualityFilter<V> {
  equals?: V
  not?: V | EqualityFilter<V>
  in?: NonNullable<V>[]
  notIn?: NonNullable<V>[]
}
interface ComparableFilter<V> extends EqualityFilter<V> {
  lt?: NonNullable<V>
  lte?: NonNullable<V>
  gt?: NonNullable<V>
  gte?: NonNullable<V>
}
interface StringFilter<V> extends ComparableFilter<V> {
  contains?: string
  startsWith?: string
  endsWith?: string
  /** `'insensitive'` → case-insensitive (`ILIKE`). Postgres-only. */
  mode?: 'default' | 'insensitive'
}
/** Postgres array-column operators (`text[]`, `int[]`, …). */
interface ListFilter<E> {
  equals?: E[]
  has?: E
  hasEvery?: E[]
  hasSome?: E[]
  isEmpty?: boolean
}

/** Pick the operator set that fits a field's underlying (non-null) type. */
type FieldFilter<V> = [NonNullable<V>] extends [ReadonlyArray<infer E>]
  ? ListFilter<E>
  : [NonNullable<V>] extends [string]
    ? StringFilter<V>
    : [NonNullable<V>] extends [number | bigint | Date]
      ? ComparableFilter<V>
      : EqualityFilter<V>

/** Field keys that are filterable columns (not methods or relation accessors). */
type Filterable<T> = {
  [K in keyof T]-?: T[K] extends (...args: any[]) => any
    ? never
    : T[K] extends RelatedManager<any> | ManyToManyManager<any>
      ? never
      : T[K] extends Promise<any> // Relation<T> = Promise<T | null>
        ? never
        : K
}[keyof T]

/** To-one relation accessors (belongsTo): `declare author: Relation<R>`. */
type ToOneKeys<T> = {
  [K in keyof T]-?: T[K] extends Promise<any> ? K : never
}[keyof T]
/** To-many relation accessors (hasMany / manyToMany). */
type ToManyKeys<T> = {
  [K in keyof T]-?: T[K] extends RelatedManager<any> | ManyToManyManager<any>
    ? K
    : never
}[keyof T]
/** The related model behind a relation accessor. */
type TargetOf<X> = X extends Promise<infer R>
  ? NonNullable<R>
  : X extends RelatedManager<infer R>
    ? R
    : X extends ManyToManyManager<infer R>
      ? R
      : never

/** To-many relation predicate — Prisma-style existential quantifiers. */
interface ToManyFilter<R> {
  /** At least one related row matches. */
  some?: WhereInput<R>
  /** Every related row matches (vacuously true if none). */
  every?: WhereInput<R>
  /** No related row matches. */
  none?: WhereInput<R>
}

/** A Prisma-shaped where clause for model `T` (scalar fields + relations). */
export type WhereInput<T> = {
  [K in Filterable<T>]?: T[K] | FieldFilter<T[K]>
} & {
  // belongsTo → nest the target's WhereInput (compiled to a correlated EXISTS).
  [K in ToOneKeys<T>]?: WhereInput<TargetOf<T[K]>>
} & {
  // hasMany / manyToMany → some/every/none over the target.
  [K in ToManyKeys<T>]?: ToManyFilter<TargetOf<T[K]>>
} & {
  AND?: WhereInput<T> | WhereInput<T>[]
  OR?: WhereInput<T>[]
  NOT?: WhereInput<T> | WhereInput<T>[]
}

/** A predicate factory bound to a kysely expression builder. */
type Predicate = (eb: ExpressionBuilder<any, any>) => Expression<SqlBool>

const asArray = <X>(v: X | X[]): X[] => (Array.isArray(v) ? v : [v])
const TRUE = (): Expression<SqlBool> => sql<SqlBool>`true`
const FALSE = (): Expression<SqlBool> => sql<SqlBool>`false`

/** Escape LIKE/ILIKE metacharacters in a user-supplied substring. */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, m => `\\${m}`)
/** `array[v1, v2, …]` with each element bound as a parameter. */
const arrayLiteral = (vs: readonly unknown[]) =>
  sql`array[${sql.join(vs.map(v => sql.val(v)))}]`

const FIELD_OPERATORS = new Set([
  'equals', 'not', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte',
  'contains', 'startsWith', 'endsWith', 'mode',
  'has', 'hasEvery', 'hasSome', 'isEmpty'
])

/**
 * Is `value` a per-field operator object (`{gt: …}`) rather than an equality
 * literal? A non-null plain object qualifies — EXCEPT a `Date` (equality) or a
 * `jsonb` column (matched whole). Arrays are equality (whole-array match); array
 * *operators* arrive as `{has: …}` objects.
 */
function isFieldFilter(
  col: ColumnDefinition,
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    col.sqlType !== 'jsonb'
  )
}

/**
 * The table a (sub)query level refers to + how its columns are qualified. At the
 * top level refs are bare (`name`); inside a correlated subquery they are
 * qualified with the table alias (`__r0.name`) to disambiguate from the outer
 * table and to correlate against it.
 */
interface Scope {
  def: ModelDefinition
  /** SQL name to qualify/correlate against (table name at top, alias in a sub). */
  ref: string
  /** Qualify field column refs as `ref.col` (true inside correlated subqueries). */
  qualify: boolean
}
const colRef = (scope: Scope, columnName: string): string =>
  scope.qualify ? `${scope.ref}.${columnName}` : columnName

/** A mutable alias counter, unique per compiled statement. */
type Counter = {n: number}

/** Compile one field's filter (operator object or equality literal) to SQL. */
function compileField(
  eb: ExpressionBuilder<any, any>,
  scope: Scope,
  col: ColumnDefinition,
  value: unknown
): Expression<SqlBool> {
  const ref = colRef(scope, col.columnName)
  if (!isFieldFilter(col, value)) {
    return value === null ? eb(ref, 'is', null) : eb(ref, '=', value as any)
  }
  for (const k of Object.keys(value)) {
    if (!FIELD_OPERATORS.has(k)) {
      throw new Error(`Unknown filter operator "${k}" on field "${col.propertyKey}".`)
    }
  }
  const ops = value as Record<string, unknown>
  const likeOp = ops.mode === 'insensitive' ? 'ilike' : 'like' // ilike: Postgres-specific (dialect override point)
  const terms: Expression<SqlBool>[] = []
  for (const [op, v] of Object.entries(ops)) {
    switch (op) {
      case 'mode':
        break
      case 'equals':
        terms.push(v === null ? eb(ref, 'is', null) : eb(ref, '=', v as any))
        break
      case 'not':
        if (v === null) terms.push(eb(ref, 'is not', null))
        else if (isFieldFilter(col, v)) terms.push(eb.not(compileField(eb, scope, col, v)))
        else terms.push(eb(ref, '<>', v as any))
        break
      case 'in':
        terms.push((v as unknown[]).length ? eb(ref, 'in', v as any) : FALSE())
        break
      case 'notIn':
        terms.push((v as unknown[]).length ? eb(ref, 'not in', v as any) : TRUE())
        break
      case 'lt':
        terms.push(eb(ref, '<', v as any))
        break
      case 'lte':
        terms.push(eb(ref, '<=', v as any))
        break
      case 'gt':
        terms.push(eb(ref, '>', v as any))
        break
      case 'gte':
        terms.push(eb(ref, '>=', v as any))
        break
      case 'contains':
        terms.push(eb(ref, likeOp, `%${escapeLike(String(v))}%`))
        break
      case 'startsWith':
        terms.push(eb(ref, likeOp, `${escapeLike(String(v))}%`))
        break
      case 'endsWith':
        terms.push(eb(ref, likeOp, `%${escapeLike(String(v))}`))
        break
      // Array operators — Postgres-specific (dialect override point).
      case 'has':
        terms.push(sql<SqlBool>`${sql.val(v)} = any(${sql.ref(ref)})`)
        break
      case 'hasEvery':
        terms.push(
          (v as unknown[]).length
            ? sql<SqlBool>`${sql.ref(ref)} @> ${arrayLiteral(v as unknown[])}`
            : TRUE()
        )
        break
      case 'hasSome':
        terms.push(
          (v as unknown[]).length
            ? sql<SqlBool>`${sql.ref(ref)} && ${arrayLiteral(v as unknown[])}`
            : FALSE()
        )
        break
      case 'isEmpty': {
        const empty = sql<SqlBool>`coalesce(array_length(${sql.ref(ref)}, 1), 0) = 0`
        terms.push(v ? empty : eb.not(empty))
        break
      }
    }
  }
  if (terms.length === 0) return TRUE()
  return terms.length === 1 ? terms[0] : eb.and(terms)
}

/** DB column name for a property on a (related) model. */
const relColumn = (def: ModelDefinition, prop: string): string =>
  def.columns.find(c => c.propertyKey === prop)?.columnName ?? prop

/** AND the related model's tenant scope into a subquery (when a tenant is bound). */
function scopeTenant(q: any, scope: Scope): any {
  const tcol = scope.def.tenantColumn
  if (!tcol) return q
  const tenant = currentTenant()
  // Unbound tenant → leave the subquery unscoped (the outer query enforces it for
  // tenant-scoped roots). `.unscoped()` on the outer query does NOT propagate here.
  if (tenant === undefined || tenant === null) return q
  return q.where(`${scope.ref}.${tcol}`, '=', tenant)
}

/**
 * Compile a relation predicate to a correlated `EXISTS` (Prisma-style, NOT a
 * join — so no row duplication, no `DISTINCT`, pagination/counts stay correct):
 *  - belongsTo → `EXISTS (SELECT 1 FROM target a WHERE a.pk = outer.fk AND <sub>)`
 *    (a filter on only the target PK collapses to the local FK column — no subquery)
 *  - hasMany/m2m `some`  → `EXISTS (… AND <sub>)`
 *               `none`  → `NOT EXISTS (… AND <sub>)`
 *               `every` → `NOT EXISTS (… AND NOT <sub>)`
 */
function compileRelation(
  eb: ExpressionBuilder<any, any>,
  outer: Scope,
  rel: RelationDefinition,
  value: unknown,
  counter: Counter
): Expression<SqlBool> {
  const targetDef = getModelDefinitionOrThrow(rel.target())

  if (rel.kind === 'belongsTo') {
    const pk = targetDef.primaryKey
    const sub = (value ?? {}) as Record<string, unknown>
    const keys = Object.keys(sub)
    // Peephole: filter on ONLY the target PK → local FK column (no subquery).
    if (pk && rel.fkColumn && keys.length === 1 && keys[0] === pk.propertyKey) {
      return compileField(eb, outer, {...pk, columnName: rel.fkColumn}, sub[pk.propertyKey])
    }
    const alias = `__r${counter.n++}`
    const inner: Scope = {def: targetDef, ref: alias, qualify: true}
    let q: any = eb
      .selectFrom(`${targetDef.tableName} as ${alias}`)
      .select(sql`1`.as('one'))
      .whereRef(`${alias}.${pk!.columnName}`, '=', `${outer.ref}.${rel.fkColumn}`)
    q = scopeTenant(q, inner)
    if (keys.length) q = q.where((eb2: any) => compileWhere(eb2, inner, sub, counter))
    return eb.exists(q)
  }

  // To-many (hasMany / manyToMany): build the correlated base, then quantify.
  const make = (sub: Record<string, unknown> | undefined, negateSub: boolean) => {
    const alias = `__r${counter.n++}`
    const inner: Scope = {def: targetDef, ref: alias, qualify: true}
    let q: any
    if (rel.kind === 'hasMany') {
      const backFk = relColumn(targetDef, rel.targetForeignKey!)
      const opk = outer.def.primaryKey!.columnName
      q = eb
        .selectFrom(`${targetDef.tableName} as ${alias}`)
        .select(sql`1`.as('one'))
        .whereRef(`${alias}.${backFk}`, '=', `${outer.ref}.${opk}`)
    } else {
      const jAlias = `__j${counter.n++}`
      const joinT = joinTableName(outer.def.tableName, targetDef.tableName, rel.through)
      const opk = outer.def.primaryKey!.columnName
      const tpk = targetDef.primaryKey!.columnName
      const src = rel.sourceColumn ?? joinColumn(outer.def.tableName, opk)
      const tgt = rel.targetColumn ?? joinColumn(targetDef.tableName, tpk)
      q = eb
        .selectFrom(`${targetDef.tableName} as ${alias}`)
        .innerJoin(`${joinT} as ${jAlias}`, `${jAlias}.${tgt}`, `${alias}.${tpk}`)
        .select(sql`1`.as('one'))
        .whereRef(`${jAlias}.${src}`, '=', `${outer.ref}.${opk}`)
    }
    q = scopeTenant(q, inner)
    if (sub && Object.keys(sub).length) {
      q = q.where((eb2: any) => {
        const p = compileWhere(eb2, inner, sub, counter)
        return negateSub ? eb2.not(p) : p
      })
    }
    return q
  }

  const v = (value ?? {}) as {some?: any; every?: any; none?: any}
  const terms: Expression<SqlBool>[] = []
  if (v.some !== undefined) terms.push(eb.exists(make(v.some, false)))
  if (v.none !== undefined) terms.push(eb.not(eb.exists(make(v.none, false))))
  if (v.every !== undefined) terms.push(eb.not(eb.exists(make(v.every, true))))
  if (terms.length === 0) return TRUE()
  return terms.length === 1 ? terms[0] : eb.and(terms)
}

/** Compile a whole `WhereInput` (fields + relations + AND/OR/NOT) to one expression. */
function compileWhere(
  eb: ExpressionBuilder<any, any>,
  scope: Scope,
  where: Record<string, unknown>,
  counter: Counter
): Expression<SqlBool> {
  const def = scope.def
  const terms: Expression<SqlBool>[] = []
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue
    if (key === 'AND') {
      const ws = asArray(value as any)
      if (ws.length) terms.push(eb.and(ws.map(w => compileWhere(eb, scope, w, counter))))
    } else if (key === 'OR') {
      const ws = asArray(value as any)
      if (ws.length) terms.push(eb.or(ws.map(w => compileWhere(eb, scope, w, counter))))
    } else if (key === 'NOT') {
      const ws = asArray(value as any)
      if (ws.length) {
        terms.push(eb.not(eb.and(ws.map(w => compileWhere(eb, scope, w, counter)))))
      }
    } else {
      const rel = def.relations.find(r => r.propertyKey === key)
      if (rel) terms.push(compileRelation(eb, scope, rel, value, counter))
      else terms.push(compileField(eb, scope, columnFor(def, key), value))
    }
  }
  if (terms.length === 0) return TRUE()
  return terms.length === 1 ? terms[0] : eb.and(terms)
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
  /** Structured filter fragments (ANDed with each other + the tenant scope). */
  where: WhereInput<any>[]
  /** Raw predicate factories (e.g. a full-text match), ANDed in. */
  raw: Predicate[]
  orderBy: {column: string; dir: 'asc' | 'desc'}[]
  /** Relevance ordering from `.search(q, {rank:true})` (applied before orderBy). */
  rank?: {ref: string; language: string; query: string}
  limit?: number
  /** Skip tenant auto-scoping for this query (cross-tenant / admin). */
  unscoped?: boolean
}

export class QuerySet<T extends object> {
  constructor(
    private readonly ctor: ModelCtor<T>,
    private readonly state: QueryState = {where: [], raw: [], orderBy: []}
  ) {}

  private get def(): ModelDefinition {
    return getModelDefinitionOrThrow(this.ctor)
  }

  private clone(patch: Partial<QueryState>): QuerySet<T> {
    return new QuerySet(this.ctor, {
      where: patch.where ?? this.state.where,
      raw: patch.raw ?? this.state.raw,
      orderBy: patch.orderBy ?? this.state.orderBy,
      rank: patch.rank ?? this.state.rank,
      limit: patch.limit ?? this.state.limit,
      unscoped: patch.unscoped ?? this.state.unscoped
    })
  }

  /** Bypass tenant auto-scoping (cross-tenant / admin queries). */
  unscoped(): QuerySet<T> {
    return this.clone({unscoped: true})
  }

  /** Every predicate for this query: structured filters + raw + tenant scope. */
  private predicates(): Predicate[] {
    const def = this.def
    const scope: Scope = {def, ref: def.tableName, qualify: false}
    const counter: Counter = {n: 0} // shared across all fragments → no alias clash
    const ps: Predicate[] = []
    for (const w of this.state.where) ps.push(eb => compileWhere(eb, scope, w, counter))
    ps.push(...this.state.raw)
    const tenantColumn = def.tenantColumn
    if (tenantColumn && !this.state.unscoped) {
      const tenant = currentTenant()
      if (tenant === undefined || tenant === null) {
        throw new Error(
          `Model "${def.tableName}" is tenant-scoped but no tenant is bound. ` +
            `Bind one via useDatabase({tenant}) / the queue runtime, or use .unscoped().`
        )
      }
      ps.push(eb => eb(tenantColumn, '=', tenant as any))
    }
    return ps
  }

  /** AND every predicate onto a kysely where-able builder (no-op if none). */
  private applyWhere<Q>(q: Q): Q {
    const ps = this.predicates()
    if (ps.length === 0) return q
    return (q as any).where((eb: ExpressionBuilder<any, any>) =>
      eb.and(ps.map(p => p(eb)))
    )
  }

  filter(where: WhereInput<T>): QuerySet<T> {
    return this.clone({where: [...this.state.where, where]})
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

  /**
   * Postgres full-text search: filters to rows whose `tsvector` column matches
   * `query` (via `websearch_to_tsquery`, which accepts plain user input). The
   * column defaults to the model's `@model({search})` vector and the language to
   * the one it was declared with. ANDs with `.filter()` / tenant scope like any
   * other predicate. Pass `{rank: true}` to also order by relevance
   * (`ts_rank` DESC) — applied to `.all()`/`.first()`, not keyset `.paginate()`.
   * POSTGRES-ONLY.
   */
  search(
    query: string,
    options: {column?: string; language?: string; rank?: boolean} = {}
  ): QuerySet<T> {
    const ftsCol = options.column
      ? columnFor(this.def, options.column)
      : this.def.columns.find(c => c.sqlType === 'tsvector')
    if (!ftsCol) {
      throw new Error(
        `${this.def.tableName}: .search() needs a tsvector column (see @model({search})).`
      )
    }
    const language = options.language ?? ftsCol.ftsLanguage ?? 'english'
    const ref = ftsCol.columnName
    // Postgres-specific (dialect override point): tsvector @@ websearch_to_tsquery.
    const predicate: Predicate = () =>
      sql<SqlBool>`${sql.ref(ref)} @@ websearch_to_tsquery(${language}, ${query})`
    const patch: Partial<QueryState> = {raw: [...this.state.raw, predicate]}
    if (options.rank) patch.rank = {ref, language, query}
    return this.clone(patch)
  }

  private build() {
    const db = getDatabase()
    let q: any = db.kysely.selectFrom(this.def.tableName).selectAll()
    q = this.applyWhere(q)
    if (this.state.rank) {
      const {ref, language, query} = this.state.rank
      // Relevance first, then any explicit orderBy as a tiebreak.
      q = q.orderBy(
        sql`ts_rank(${sql.ref(ref)}, websearch_to_tsquery(${language}, ${query}))` as any,
        'desc'
      )
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

  async get(conditions?: WhereInput<T>): Promise<T> {
    const qs = conditions ? this.filter(conditions) : this
    const rows = await qs.limit(2).build().execute()
    if (rows.length === 0) {
      throw new NotFoundError(this.def.tableName, conditions as Record<string, unknown> | undefined)
    }
    if (rows.length > 1) {
      throw new Error(`${this.def.tableName}: .get() matched multiple rows`)
    }
    return hydrate(this.ctor, rows[0])
  }

  async count(): Promise<number> {
    const db = getDatabase()
    let q: any = db.kysely
      .selectFrom(this.def.tableName)
      .select(db.kysely.fn.countAll().as('count'))
    q = this.applyWhere(q)
    const row = await q.executeTakeFirstOrThrow()
    return Number((row as any).count)
  }

  /** Delete every row matching the current filter. Returns the count deleted. */
  async delete(): Promise<number> {
    const db = getDatabase()
    let q: any = db.kysely.deleteFrom(this.def.tableName)
    q = this.applyWhere(q)
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
    let q: any = db.kysely.selectFrom(this.def.tableName).selectAll()
    q = this.applyWhere(q)
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
      // `undefined` = "don't touch this column" (Prisma semantics); `null` sets null.
      if (value !== undefined) data[columnFor(this.def, key).columnName] = value
    }
    if (Object.keys(data).length === 0) return 0 // nothing to set → no-op
    let q: any = db.kysely.updateTable(this.def.tableName).set(data)
    q = this.applyWhere(q)
    const res = await q.executeTakeFirst()
    return Number(res?.numUpdatedRows ?? 0)
  }
}

export class Manager<T extends object> {
  constructor(private readonly ctor: ModelCtor<T>) {}

  private qs(): QuerySet<T> {
    return new QuerySet(this.ctor)
  }

  filter(where: WhereInput<T>): QuerySet<T> {
    return this.qs().filter(where)
  }

  orderBy(field: keyof T | `-${string & keyof T}`): QuerySet<T> {
    return this.qs().orderBy(field)
  }

  /** Postgres full-text search (see `QuerySet.search`). */
  search(
    query: string,
    options?: {column?: string; language?: string; rank?: boolean}
  ): QuerySet<T> {
    return this.qs().search(query, options)
  }

  all(): Promise<T[]> {
    return this.qs().all()
  }

  first(): Promise<T | null> {
    return this.qs().first()
  }

  get(conditions?: WhereInput<T>): Promise<T> {
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
    assignDefined(instance, values)
    await saveInstance(instance as object)
    return instance
  }

  /**
   * Insert many rows in a single round-trip (one `INSERT … VALUES (…),(…)`).
   * Each row gets create defaults + validation, then `preSave`/`postSave` fire
   * ONCE with the whole `instances` array (so an audit handler can itself batch).
   * Pass `{signals: false}` for raw seed/import throughput (no lifecycle hooks).
   */
  createMany(values: Partial<T>[], options?: BulkOptions): Promise<T[]> {
    return createMany(this.ctor, values, options)
  }
}

/** Options for bulk instance ops. */
export interface BulkOptions {
  /** Fire lifecycle signals (default true). `false` = raw, for seeds/imports. */
  signals?: boolean
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

/**
 * Create-time prep shared by `saveInstance` (insert path) and `createMany`:
 * stamp the ambient tenant on the tenant column when unset, then resolve
 * client-side default generators (cuid/uuid ids). Runs before validation so a
 * generated NOT NULL PK satisfies its constraint.
 */
function applyCreateDefaults(def: ModelDefinition, instance: any): void {
  if (def.tenantColumn) {
    const tcol = def.columns.find(c => c.columnName === def.tenantColumn)
    if (tcol) {
      const current = instance[tcol.propertyKey]
      if (current === undefined || current === null) {
        const tenant = currentTenant()
        if (tenant === undefined || tenant === null) {
          throw new Error(
            `Cannot create "${def.tableName}": tenant-scoped but no tenant bound and ` +
              `"${tcol.propertyKey}" was not provided.`
          )
        }
        instance[tcol.propertyKey] = tenant
      }
    }
  }
  for (const col of def.columns) {
    if (!col.defaultFn) continue
    const cur = instance[col.propertyKey]
    if (cur === undefined || cur === null) instance[col.propertyKey] = col.defaultFn()
  }
}

export async function saveInstance(instance: object): Promise<object> {
  const def = getModelDefinitionOrThrow(instance.constructor)

  if (!persisted.has(instance)) applyCreateDefaults(def, instance)

  // Validate before touching the DB — fail fast with structured, translatable
  // issues instead of a raw Postgres constraint error.
  const issues = validateInstance(def, instance)
  if (issues.length > 0) throw new ValidationError(issues)

  const db = getDatabase()
  const pk = def.primaryKey
  const created = !(persisted.has(instance) && pk)
  const model = instance.constructor as Function

  // Re-run client-side update generators (e.g. updatedAt) on every UPDATE.
  // (On INSERT, the `default` generator already filled the value.)
  if (!created) {
    for (const col of def.columns) {
      if (col.onUpdateFn) (instance as any)[col.propertyKey] = col.onUpdateFn()
    }
  }

  await signals.preSave.emit({instances: [instance], created, model})

  try {
    if (!created) {
      const data = rowFromInstance(def, instance, {includePrimaryKey: false})
      await db.kysely
        .updateTable(def.tableName)
        .set(data)
        .where(pk!.columnName, '=', (instance as any)[pk!.propertyKey])
        .execute()
    } else {
      const data = rowFromInstance(def, instance, {includePrimaryKey: true})
      const insert = db.kysely.insertInto(def.tableName)
      // An all-defaults row (every settable column omitted/undefined) must emit
      // `INSERT … DEFAULT VALUES`, not `() VALUES ()` (a Postgres syntax error).
      const inserted = await (
        Object.keys(data).length ? insert.values(data) : insert.defaultValues()
      )
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
  } catch (err) {
    // A unique violation (23505) → a precise `'unique'` field error, so a
    // duplicate surfaces as a userError instead of a masked "Unexpected error".
    const ve = uniqueViolation(def, err)
    if (ve) throw ve
    throw err
  }

  await signals.postSave.emit({instances: [instance], created, model})
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
  await signals.preDelete.emit({instances: [instance], model})
  await db.kysely
    .deleteFrom(def.tableName)
    .where(pk.columnName, '=', (instance as any)[pk.propertyKey])
    .execute()
  persisted.delete(instance)
  await signals.postDelete.emit({instances: [instance], model})
}

/**
 * Insert many rows in one round-trip. See `Manager.createMany`. The Postgres
 * `RETURNING` rows come back in VALUES order, so generated values map back by
 * index.
 */
export async function createMany<T extends object>(
  ctor: ModelCtor<T>,
  values: Partial<T>[],
  options: BulkOptions = {}
): Promise<T[]> {
  if (values.length === 0) return []
  const def = getModelDefinitionOrThrow(ctor)
  const emit = options.signals !== false
  const model = ctor as Function

  const instances = values.map(v => {
    const inst = new ctor()
    assignDefined(inst, v)
    applyCreateDefaults(def, inst as any)
    const issues = validateInstance(def, inst as object)
    if (issues.length > 0) throw new ValidationError(issues)
    return inst
  })

  if (emit) await signals.preSave.emit({instances, created: true, model})

  const rows = instances.map(i =>
    rowFromInstance(def, i, {includePrimaryKey: true})
  )
  // Mixed rows are fine (kysely fills missing keys with `default`); only an
  // ALL-empty batch needs `DEFAULT VALUES` per row (an empty `() values (),()`
  // is a Postgres syntax error).
  const allDefaults = rows.every(r => Object.keys(r).length === 0)
  let inserted: any[]
  try {
    const kysely = getDatabase().kysely
    inserted = allDefaults
      ? await Promise.all(
          rows.map(() =>
            kysely.insertInto(def.tableName).defaultValues().returningAll().executeTakeFirstOrThrow()
          )
        )
      : await kysely.insertInto(def.tableName).values(rows as any).returningAll().execute()
  } catch (err) {
    const ve = uniqueViolation(def, err)
    if (ve) throw ve
    throw err
  }
  inserted.forEach((row, idx) => {
    const inst = instances[idx] as any
    for (const col of def.columns) {
      if (col.columnName in row) inst[col.propertyKey] = row[col.columnName]
    }
    persisted.add(instances[idx] as object)
  })

  if (emit) await signals.postSave.emit({instances, created: true, model})
  return instances
}

/**
 * Delete many already-loaded instances in one round-trip (`DELETE … WHERE pk IN
 * (…)`), firing `preDelete`/`postDelete` once with the whole `instances` array.
 * `{signals: false}` skips the hooks.
 */
export async function deleteManyInstances<T extends object>(
  instances: T[],
  options: BulkOptions = {}
): Promise<void> {
  if (instances.length === 0) return
  const def = getModelDefinitionOrThrow((instances[0] as object).constructor)
  const pk = def.primaryKey
  if (!pk) {
    throw new Error(`Cannot delete "${def.tableName}": no primary key defined.`)
  }
  const emit = options.signals !== false
  const model = (instances[0] as object).constructor as Function
  if (emit) await signals.preDelete.emit({instances, model})
  await getDatabase()
    .kysely.deleteFrom(def.tableName)
    .where(pk.columnName, 'in', instances.map(i => (i as any)[pk.propertyKey]) as any)
    .execute()
  for (const i of instances) persisted.delete(i as object)
  if (emit) await signals.postDelete.emit({instances, model})
}
