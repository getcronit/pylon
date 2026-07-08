import {sql, type Expression, type ExpressionBuilder, type SqlBool} from 'kysely'
import {joinColumn, joinTableName} from '@getcronit/pylon-ir'
import {currentTenant, dbLog, isSystem} from './app-context.js'
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
import {ForbiddenError} from './features.js'
import {type FilterAction, getAppPolicy, getPolicy, policyContext} from './policies.js'
// Runtime cycle with keyed-query.ts (which imports QuerySet) — safe: neither uses the
// other's binding at module top-level (only inside method/function bodies).
import {keyedTerminalFor} from './keyed-query.js'
import {noteQuery} from './n-plus-one.js'
// Type-only (erased at runtime → no import cycle with relations.ts) — used to
// exclude relation accessors from the set of filterable fields.
import type {ManyToManyManager, RelatedManager} from './relations.js'
// Paginated relation accessors ({paginate: true}) — callable Connection fields.
// Type-only (erased) so no runtime cycle with fields.ts.
import type {PaginatedHasMany, PaginatedManyToMany} from './fields.js'
import {parseSearchQuery} from './query-parser.js'
import type {QueryScope} from './query-schema.js'

export type ModelCtor<T> = {new (): T}

/** Tracks which instances came from / have been written to the database. */
const persisted = new WeakSet<object>()

export function columnFor(
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
  // Instantiate the REGISTERED class, not the passed-in `ctor`. They differ when a
  // project is split across esbuild bundles (e.g. a runtime-config/middleware bundle):
  // each bundle inlines its own copy of the model class, but only the copy whose app was
  // constructed is FINALIZED — i.e. has the field-storage accessors installed. A
  // duplicate copy resolves (by name) to the same def, but `new copy()` yields a BLANK
  // object because assignments have nowhere to land. `def.ctor` is always the finalized
  // class, so it hydrates correctly. (Same class in the common single-bundle case.)
  const instance = new (def.ctor as ModelCtor<T>)()
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
/** To-many relation accessors (hasMany / manyToMany — plain or `{paginate}`). */
type ToManyKeys<T> = {
  [K in keyof T]-?: T[K] extends
    | RelatedManager<any>
    | ManyToManyManager<any>
    | PaginatedHasMany<any>
    | PaginatedManyToMany<any>
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
      : X extends PaginatedHasMany<infer R>
        ? R
        : X extends PaginatedManyToMany<infer R>
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
  // Full-text search on a `tsvector` column → GIN-indexed match. `{search}` →
  // websearch_to_tsquery (phrase-aware); `{search, prefix}` → to_tsquery with a
  // `:*` prefix on each sanitized lexeme. Emitted by the search-query DSL's
  // default (bare-term) search; far cheaper than substring `ILIKE '%x%'`.
  if (
    col.sqlType === 'tsvector' &&
    value !== null &&
    typeof value === 'object' &&
    'search' in (value as object)
  ) {
    const {search, prefix} = value as {search: unknown; prefix?: boolean}
    const term = String(search ?? '')
    const lang = col.ftsLanguage ?? 'english'
    if (!term.trim()) return TRUE()
    if (prefix) {
      // to_tsquery is strict — reduce to alnum lexemes, each prefix-matched.
      const tsq = term
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(w => `${w}:*`)
        .join(' & ')
      return tsq ? sql<SqlBool>`${sql.ref(ref)} @@ to_tsquery(${lang}, ${tsq})` : TRUE()
    }
    // Quote multi-word terms so websearch treats them as a phrase.
    const web = /\s/.test(term) ? `"${term}"` : term
    return sql<SqlBool>`${sql.ref(ref)} @@ websearch_to_tsquery(${lang}, ${web})`
  }
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

  if (rel.kind === 'hasOne') {
    // Inverse 1:1 → correlated EXISTS over the target's back-FK = our PK, nesting
    // the target's WhereInput directly (no some/every/none — it's to-one).
    const backFk = relColumn(targetDef, rel.targetForeignKey!)
    const opk = outer.def.primaryKey!.columnName
    const sub = (value ?? {}) as Record<string, unknown>
    const alias = `__r${counter.n++}`
    const inner: Scope = {def: targetDef, ref: alias, qualify: true}
    let q: any = eb
      .selectFrom(`${targetDef.tableName} as ${alias}`)
      .select(sql`1`.as('one'))
      .whereRef(`${alias}.${backFk}`, '=', `${outer.ref}.${opk}`)
    q = scopeTenant(q, inner)
    if (Object.keys(sub).length) q = q.where((eb2: any) => compileWhere(eb2, inner, sub, counter))
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

// ── Row-level policy enforcement ─────────────────────────────────────────────

/** Resolve a model's policy rule for an action into 'allow' / 'deny' / a filter. */
function policyOutcome(
  def: ModelDefinition,
  action: FilterAction
): 'allow' | 'deny' | Record<string, unknown> {
  // per-model rule → app-wide default (models.app({policy})) → secure deny / allow.
  const rule = getPolicy(def)?.[action] ?? getAppPolicy(def.app)?.[action]
  if (!rule) {
    const outcome = def.secure ? 'deny' : 'allow' // secure ⇒ fail closed
    dbLog('policy', `${def.tableName}.${action} → ${outcome} (no rule; secure=${def.secure})`)
    return outcome
  }
  const result = rule(policyContext())
  const outcome = result === true ? 'allow' : result === false ? 'deny' : result
  dbLog(
    'policy',
    `${def.tableName}.${action} → ${typeof outcome === 'string' ? outcome : 'row-filter'}`,
    typeof outcome === 'object' ? outcome : undefined
  )
  return outcome as 'allow' | 'deny' | Record<string, unknown>
}

/**
 * AND a model's row-level policy for `action` onto a kysely query builder. Used
 * by the relation loaders (a relation read re-applies the target's read policy,
 * so traversal can't surface rows you couldn't query directly). Refs are
 * qualified by `ref` (the table/alias) so it composes inside joins. QuerySet
 * applies policy through `predicates()` instead (bare top-level refs).
 */
export function applyPolicyWhere<Q>(
  qb: Q,
  def: ModelDefinition,
  action: FilterAction,
  ref: string = def.tableName
): Q {
  if (isSystem()) return qb
  const outcome = policyOutcome(def, action)
  if (outcome === 'allow') return qb
  const scope: Scope = {def, ref, qualify: true}
  return (qb as any).where((eb: ExpressionBuilder<any, any>) =>
    outcome === 'deny' ? FALSE() : compileWhere(eb, scope, outcome, {n: 0})
  )
}

/**
 * Whether the current principal's READ policy FULLY denies `def` (vs. allowing or
 * filtering by row). The relation loaders use this to turn a NON-NULL relation that
 * resolved to null into a precise `ForbiddenError` instead of GraphQL's opaque
 * "Cannot return null for non-nullable field". System reads (`runAsSystem`) never
 * deny. A row-level outcome is not a flat deny — the row may simply not match — so
 * it returns false (the caller reports a generic dangling-reference error instead).
 */
export function readPolicyDenies(def: ModelDefinition): boolean {
  return !isSystem() && policyOutcome(def, 'read') === 'deny'
}

/**
 * AND a model's TENANT scope onto a relation-loader query, mirroring QuerySet
 * `predicates()` so a relation read is scoped EXACTLY like a direct query: walking
 * a relation can't surface rows in another tenant (or any rows when no tenant is
 * bound). Without this, `belongsTo`/`hasMany` loaders applied only the read policy —
 * which, for a tenant-agnostic policy like `!!principal`, let traversal off a
 * cross-tenant instance leak another tenant's rows. `runAsSystem` bypasses; a
 * tenant-root model (no tenant column, e.g. Organization) is a no-op. `ref`
 * qualifies the column for the loader's single-table select.
 */
export function applyTenantWhere<Q>(
  qb: Q,
  def: ModelDefinition,
  ref: string = def.tableName
): Q {
  if (isSystem()) return qb
  const tcol = def.tenantColumn
  if (!tcol) return qb
  const tenant = currentTenant()
  if (tenant === undefined || tenant === null) {
    throw new Error(
      `Model "${def.tableName}" is tenant-scoped but no tenant is bound. ` +
        `Bind one via useDatabase({tenant}) / the queue runtime, or traverse ` +
        `within runAsSystem().`
    )
  }
  dbLog('tenant', `${def.tableName} (relation) scoped: ${tcol} = ${String(tenant)}`)
  return (qb as any).where(`${ref}.${tcol}`, '=', tenant)
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
  /**
   * Field(s) to order + key on; `-` prefix for descending. Defaults to the PK.
   * Pass an ARRAY for a composite keyset (e.g. `['-type', 'name']` to group one
   * column first, then sort within it) — the PK is appended as the tiebreaker so
   * the keyset stays total. A single string keeps the original two-column path.
   */
  orderBy?: string | string[]
  /**
   * Shopify/GitHub-style search-query DSL (`status:OPEN -isRead:true "phrase"`),
   * parsed against this model's columns and AND-ed onto the current filter. A
   * scalar in the GraphQL layer, so it needs no per-model filter-input type.
   */
  query?: string
}

/** Keyset cursor = base64url(JSON(orderBy value)). */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
export function decodeCursor(cursor: string): unknown {
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

  /**
   * Every predicate for this query: structured filters + raw FTS + tenant scope +
   * the row-level policy for `action`. `.unscoped()` drops BOTH tenant and policy
   * (trusted system/admin code). `action` selects which policy rule applies —
   * 'read' for selects/counts, 'update'/'delete' for the bulk writers.
   */
  private predicates(action: FilterAction): Predicate[] {
    const def = this.def
    const scope: Scope = {def, ref: def.tableName, qualify: false}
    const counter: Counter = {n: 0} // shared across all fragments → no alias clash
    const ps: Predicate[] = []
    for (const w of this.state.where) ps.push(eb => compileWhere(eb, scope, w, counter))
    ps.push(...this.state.raw)
    // `.unscoped()` (per-query) or `runAsSystem` (ambient) lift tenant + policy.
    const scoped = !this.state.unscoped && !isSystem()
    const tenantColumn = def.tenantColumn
    if (tenantColumn && scoped) {
      const tenant = currentTenant()
      if (tenant === undefined || tenant === null) {
        throw new Error(
          `Model "${def.tableName}" is tenant-scoped but no tenant is bound. ` +
            `Bind one via useDatabase({tenant}) / the queue runtime, or use .unscoped().`
        )
      }
      dbLog('tenant', `${def.tableName} scoped: ${tenantColumn} = ${String(tenant)}`)
      ps.push(eb => eb(tenantColumn, '=', tenant as any))
    } else if (tenantColumn) {
      dbLog(
        'tenant',
        `${def.tableName} UNSCOPED (${isSystem() ? 'runAsSystem' : '.unscoped()'})`
      )
    }
    if (scoped) {
      const outcome = policyOutcome(def, action)
      if (outcome === 'deny') ps.push(() => FALSE())
      else if (outcome !== 'allow') ps.push(eb => compileWhere(eb, scope, outcome, counter))
    }
    return ps
  }

  /** AND every predicate for `action` onto a kysely where-able builder. */
  private applyWhere<Q>(q: Q, action: FilterAction = 'read'): Q {
    const ps = this.predicates(action)
    if (ps.length === 0) return q
    return (q as any).where((eb: ExpressionBuilder<any, any>) =>
      eb.and(ps.map(p => p(eb)))
    )
  }

  filter(where: WhereInput<T>): QuerySet<T> {
    return this.clone({where: [...this.state.where, where]})
  }

  /**
   * Narrow by a Shopify/GitHub-style search-query string (`status:OPEN -isRead:true
   * "phrase"`), parsed against this model's columns into a `WhereInput`. The
   * scalar-string twin of `.filter()` — handy for a GraphQL `query: String` arg
   * with no per-model filter-input type. Empty/whitespace → no-op.
   */
  query(queryStr: string, opts: {scope?: QueryScope} = {}): QuerySet<T> {
    return this.filter(parseSearchQuery(queryStr, this.def, opts) as unknown as WhereInput<T>)
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
    let q: any = db.kysely.selectFrom(this.def.tableName).select(selectableColumns(this.def))
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
    const keyed = keyedTerminalFor(this.ctor, this.state.where, !!this.state.unscoped)
    if (keyed) return keyed.all(this.state.orderBy) as Promise<T[]>
    noteQuery(this.ctor, 'all') // un-batched → N+1 advisory (dev-only)
    const rows = await this.build().execute()
    return rows.map(r => hydrate(this.ctor, r))
  }

  async first(): Promise<T | null> {
    const keyed = keyedTerminalFor(this.ctor, this.state.where, !!this.state.unscoped)
    if (keyed) return keyed.first(this.state.orderBy) as Promise<T | null>
    noteQuery(this.ctor, 'first') // un-batched → N+1 advisory (dev-only)
    const rows = await this.limit(1).build().execute()
    return rows.length ? hydrate(this.ctor, rows[0]) : null
  }

  /** True if any row matches. Batches on a batchKey() marker (via count()). */
  async exists(): Promise<boolean> {
    return (await this.count()) > 0
  }

  async get(conditions?: WhereInput<T>): Promise<T> {
    const qs = conditions ? this.filter(conditions) : this
    noteQuery(this.ctor, 'get') // un-batched → N+1 advisory (dev-only)
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
    // If the predicate carries a batchKey() marker, coalesce across the microtask
    // (or throw if it's marked-but-unbatchable — §10). Marker-free → plain count.
    const keyed = keyedTerminalFor(this.ctor, this.state.where, !!this.state.unscoped)
    if (keyed) return keyed.count()
    noteQuery(this.ctor, 'count') // un-batched → N+1 advisory (dev-only)
    const db = getDatabase()
    let q: any = db.kysely
      .selectFrom(this.def.tableName)
      .select(db.kysely.fn.countAll().as('count'))
    q = this.applyWhere(q)
    const row = await q.executeTakeFirstOrThrow()
    return Number((row as any).count)
  }

  /**
   * Grouped count over a set of foreign-key values — the batched twin of
   * `count()`. Runs ONE `SELECT fk, count(*) WHERE fk IN (values) AND <this
   * query's predicates> GROUP BY fk` and returns `fkValue → count` (absent = 0).
   * This query's `.filter()` predicates + tenant scope + row policy all apply
   * (via `applyWhere`). Used by the relation-count batcher so N parents'
   * `children.filter(P).count()` collapse into a single round-trip.
   */
  async groupedCountByFk(
    fkColumn: string,
    values: readonly unknown[]
  ): Promise<Map<unknown, number>> {
    const out = new Map<unknown, number>()
    if (values.length === 0) return out
    const db = getDatabase()
    let q: any = db.kysely
      .selectFrom(this.def.tableName)
      .select((eb: ExpressionBuilder<any, any>) => [
        eb.ref(fkColumn).as('k'),
        eb.fn.countAll().as('n')
      ])
      .where(fkColumn as any, 'in', values as any)
    q = this.applyWhere(q)
    q = q.groupBy(fkColumn as any)
    const rows = await q.execute()
    for (const r of rows) out.set((r as any).k, Number((r as any).n))
    return out
  }

  /**
   * The rows twin of `groupedCountByFk`: `SELECT * WHERE fk IN (values) AND <this
   * query's predicates>`, hydrated and grouped `fkValue → rows` (absent = []). Same
   * scope (tenant + policy + `.filter()`) via `applyWhere`. Used by the keyed-query
   * materialize terminals (`.all()`/`.first()`); ordering is applied by the caller
   * after the union (in memory), so no ORDER BY here.
   */
  async groupedRowsByFk(
    fkColumn: string,
    values: readonly unknown[]
  ): Promise<Map<unknown, T[]>> {
    const out = new Map<unknown, T[]>()
    if (values.length === 0) return out
    const db = getDatabase()
    let q: any = db.kysely
      .selectFrom(this.def.tableName)
      .select(selectableColumns(this.def))
      .where(fkColumn as any, 'in', values as any)
    q = this.applyWhere(q)
    const rows = await q.execute()
    for (const r of rows) {
      const k = (r as any)[fkColumn]
      const list = out.get(k) ?? []
      list.push(hydrate(this.ctor, r))
      out.set(k, list)
    }
    return out
  }

  /**
   * Lightweight `(fk, pk)` pairs: `SELECT fk, pk WHERE fk IN (values) AND <predicates>`,
   * grouped `fkValue → pk[]` (absent = []). The count(DISTINCT) substrate for keyed
   * counts over MULTIPLE paths — dedup the pk sets in memory (a row a key matches via
   * two paths appears once), without pulling full rows. Same scope via `applyWhere`.
   */
  async groupedIdsByFk(
    fkColumn: string,
    pkColumn: string,
    values: readonly unknown[]
  ): Promise<Map<unknown, unknown[]>> {
    const out = new Map<unknown, unknown[]>()
    if (values.length === 0) return out
    const db = getDatabase()
    let q: any = db.kysely
      .selectFrom(this.def.tableName)
      .select((eb: ExpressionBuilder<any, any>) => [
        eb.ref(fkColumn).as('k'),
        eb.ref(pkColumn).as('id')
      ])
      .where(fkColumn as any, 'in', values as any)
    q = this.applyWhere(q)
    const rows = await q.execute()
    for (const r of rows) {
      const k = (r as any).k
      const list = out.get(k) ?? []
      list.push((r as any).id)
      out.set(k, list)
    }
    return out
  }

  /** Delete every row matching the current filter. Returns the count deleted. */
  async delete(): Promise<number> {
    const db = getDatabase()
    let q: any = db.kysely.deleteFrom(this.def.tableName)
    q = this.applyWhere(q, 'delete')
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
    // The `query` DSL is merged into the filter, then we re-enter without it
    // (one level — the keyset logic below is unchanged).
    if (args.query) {
      return this.query(args.query).paginate({...args, query: undefined})
    }
    // Composite keyset (opt-in) — the single-string path below is left untouched.
    if (Array.isArray(args.orderBy)) return this.paginateComposite(args.orderBy, args)
    noteQuery(this.ctor, 'paginate') // paginated relations aren't batched → N+1 advisory
    const raw = args.orderBy ?? this.def.primaryKey?.propertyKey
    if (!raw) {
      throw new Error(`${this.def.tableName}: .paginate() needs an orderBy or a primary key.`)
    }
    const desc = raw.startsWith('-')
    const col = columnFor(this.def, desc ? raw.slice(1) : raw).columnName

    // Keyset tiebreaker. The order column alone is rarely unique and may be
    // NULLABLE, which makes a single-column keyset INCOMPLETE: rows that share an
    // order value get skipped at page boundaries, and NULL-valued rows are
    // unreachable (`col > cursor` is never true for NULL). So we page on the
    // composite (orderCol, primaryKey) — the PK is unique + non-null, making the
    // keyset total — with explicit NULLS ordering in the seek predicate.
    const pkCol = this.def.primaryKey?.columnName
    const composite = !!pkCol && pkCol !== col

    // Backward paging walks the reverse of the natural order, then flips back.
    const backward = args.last !== undefined || args.before !== undefined
    const size = (backward ? args.last : args.first) ?? 20
    const naturalAsc = !desc
    // Effective (possibly reversed) direction + NULL placement applied to SQL.
    // Natural order keeps NULLs LAST; reversing for backward puts them FIRST so
    // they land last again after the page is flipped back.
    const ea = backward ? !naturalAsc : naturalAsc // effective ascending?
    const nullsLast = !backward
    const dir: 'asc' | 'desc' = ea ? 'asc' : 'desc'
    const gt = ea ? '>' : '<'

    const db = getDatabase()
    let q: any = db.kysely.selectFrom(this.def.tableName).select(selectableColumns(this.def))
    q = this.applyWhere(q)

    const cursorArg = backward ? args.before : args.after
    if (cursorArg !== undefined) {
      const decoded = decodeCursor(cursorArg) as any
      // New cursors are [orderValue, pkValue]; tolerate legacy scalar cursors.
      const [cv, ck] = Array.isArray(decoded) ? decoded : [decoded, undefined]
      if (composite) {
        q = q.where((eb: any) => {
          if (cv !== null && cv !== undefined) {
            const base = eb.or([
              eb(col, gt, cv),
              eb.and([eb(col, '=', cv), eb(pkCol!, gt, ck)])
            ])
            // NULLs sit after the non-nulls (nullsLast) → a non-null cursor's
            // "after" includes them; otherwise they precede and are excluded.
            return nullsLast ? eb.or([base, eb(col, 'is', null)]) : base
          }
          // Cursor sits on a NULL row → seek within the NULL group by PK, and
          // (when NULLs come first) the non-null section follows.
          const nullPart = eb.and([eb(col, 'is', null), eb(pkCol!, gt, ck)])
          return nullsLast ? nullPart : eb.or([nullPart, eb(col, 'is not', null)])
        })
      } else {
        q = q.where(col, gt, Array.isArray(decoded) ? cv : decoded)
      }
    }

    q = composite
      ? q
          .orderBy(
            sql`${sql.ref(col)} ${sql.raw(dir)} nulls ${sql.raw(
              nullsLast ? 'last' : 'first'
            )}`
          )
          .orderBy(pkCol as any, dir)
      : q.orderBy(col as any, dir)
    if (!backward && args.skip) q = q.offset(args.skip)

    const fetched = await q.limit(size + 1).execute()
    const hasExtra = fetched.length > size
    let page = hasExtra ? fetched.slice(0, size) : fetched
    if (backward) page = page.reverse() // restore natural order

    const cursorOf = (r: any) =>
      encodeCursor(composite ? [r[col], r[pkCol!]] : r[col])
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

  /**
   * Composite-keyset pagination — the multi-column twin of the single-`orderBy` path.
   * `keys` are property names (each optionally `-`-prefixed for descending); the PK is
   * appended as the final tiebreaker so the keyset stays total. NULLs sort last in
   * forward order (first when paging backward), matching the single-key path. The cursor
   * is the ordered tuple of the keyset column values.
   */
  private async paginateComposite(
    keys: string[],
    args: PaginateArgs
  ): Promise<Connection<T>> {
    noteQuery(this.ctor, 'paginate') // not batched → N+1 advisory (dev-only)
    const pkCol = this.def.primaryKey?.columnName
    if (!pkCol) {
      throw new Error(`${this.def.tableName}: composite .paginate() needs a primary key.`)
    }
    // Resolve property → column + natural direction; ensure the PK is the last key.
    const cols = keys.map(raw => {
      const desc = raw.startsWith('-')
      return {col: columnFor(this.def, desc ? raw.slice(1) : raw).columnName, asc: !desc}
    })
    if (!cols.some(c => c.col === pkCol)) cols.push({col: pkCol, asc: true})

    const backward = args.last !== undefined || args.before !== undefined
    const size = (backward ? args.last : args.first) ?? 20
    const nullsLast = !backward
    // Effective per-column direction (reversed for backward paging, flipped back later).
    const eff = cols.map(c => {
      const ea = backward ? !c.asc : c.asc
      return {col: c.col, dir: (ea ? 'asc' : 'desc') as 'asc' | 'desc', gt: ea ? '>' : '<'}
    })

    const db = getDatabase()
    let q: any = db.kysely
      .selectFrom(this.def.tableName)
      .select(selectableColumns(this.def))
    q = this.applyWhere(q)

    const cursorArg = backward ? args.before : args.after
    if (cursorArg !== undefined) {
      const decoded = decodeCursor(cursorArg)
      const vals = (Array.isArray(decoded) ? decoded : [decoded]) as unknown[]
      q = q.where((eb: any) => {
        const isNull = (v: unknown) => v === null || v === undefined
        // Cursor row's value equals v in this column (null-aware equality).
        const eq = (col: string, v: unknown) =>
          isNull(v) ? eb(col, 'is', null) : eb(col, '=', v)
        // Rows strictly PAST v in column i's effective order + NULL placement.
        const after = (i: number, v: unknown): Expression<SqlBool> => {
          const {col, gt} = eff[i]
          if (isNull(v)) {
            // nulls last → nothing sorts after a null; nulls first → the non-nulls do.
            return nullsLast ? FALSE() : eb(col, 'is not', null)
          }
          const base = eb(col, gt, v)
          return nullsLast ? eb.or([base, eb(col, 'is', null)]) : base
        }
        // OR over positions i: all prefix columns equal, column i strictly after.
        return eb.or(
          eff.map((_: unknown, i: number) =>
            eb.and([
              ...eff.slice(0, i).map((k, j) => eq(k.col, vals[j])),
              after(i, vals[i])
            ])
          )
        )
      })
    }

    for (const k of eff) {
      q = q.orderBy(
        sql`${sql.ref(k.col)} ${sql.raw(k.dir)} nulls ${sql.raw(
          nullsLast ? 'last' : 'first'
        )}`
      )
    }
    if (!backward && args.skip) q = q.offset(args.skip)

    const fetched = await q.limit(size + 1).execute()
    const hasExtra = fetched.length > size
    let page = hasExtra ? fetched.slice(0, size) : fetched
    if (backward) page = page.reverse() // restore natural order

    const cursorOf = (r: any) => encodeCursor(cols.map(c => r[c.col]))
    const edges = page.map((r: any) => ({
      cursor: cursorOf(r),
      node: hydrate(this.ctor, r)
    }))
    return {
      edges,
      nodes: edges.map((e: {node: T}) => e.node),
      totalCount: await this.count(),
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
    q = this.applyWhere(q, 'update')
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

  /** Narrow by a search-query DSL string (see {@link QuerySet.query}). */
  query(queryStr: string, opts?: {scope?: QueryScope}): QuerySet<T> {
    return this.qs().query(queryStr, opts)
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
    // Build the REGISTERED (finalized) class — see `hydrate`; a duplicate bundle copy is
    // unfinalized and would produce a blank instance.
    const instance = new (getModelDefinitionOrThrow(this.ctor).ctor as ModelCtor<T>)()
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
    // Generated columns (e.g. a STORED `tsvector` from `@model({search})`) are
    // DB-managed — `GENERATED ALWAYS`. They're hydrated by `selectAll()`, so a
    // loaded instance carries them; never write them back or Postgres rejects it.
    if (col.generatedAs) continue
    if (col.primaryKey && !includePrimaryKey) continue
    const value = instance[col.propertyKey]
    if (value !== undefined) data[col.columnName] = value
  }
  return data
}

/**
 * Copy a returned DB row's columns back onto the instance. Keeps the in-memory
 * object DB-consistent after a write — pulls back identity PKs, DB defaults,
 * generated/triggered columns, AND heals any field a caller set to `undefined`
 * (which is omitted from the write, so the DB value is authoritative).
 */
function copyRowOnto(def: ModelDefinition, instance: any, row: any): void {
  for (const col of def.columns) {
    if (col.columnName in row) instance[col.propertyKey] = row[col.columnName]
  }
}

/**
 * Column names to SELECT for a model — every column EXCEPT internal DB-managed
 * generated ones (the hidden `tsvector` from `@model({search})`). Those are
 * large, hidden from the API, write-only by the DB, and never read as an
 * instance value — `.search()` references them in the WHERE clause directly — so
 * fetching them just wastes wire + CPU on every read. Optionally qualified by a
 * table/alias for joined queries. Replaces `selectAll()` on the read paths.
 */
export function selectableColumns(def: ModelDefinition, table?: string): string[] {
  const names = def.columns
    .filter(c => !(c.generatedAs && c.hidden))
    .map(c => c.columnName)
  return table ? names.map(n => `${table}.${n}`) : names
}

/**
 * Create-time prep shared by `saveInstance` (insert path) and `createMany`:
 * stamp the ambient tenant on the tenant column when unset, then resolve
 * client-side default generators (cuid/uuid ids). Runs before validation so a
 * generated NOT NULL PK satisfies its constraint.
 */
/**
 * Create authorization: there's no row to filter, so the `create` rule is a
 * boolean gate; `onCreate` then stamps server-owned columns (e.g. ownerId) from
 * the principal so they're never trusted from input. On a `secure` model, the
 * absence of a create rule denies. Runs before defaults/validation so a stamped
 * NOT NULL column satisfies its constraint.
 */
function enforceCreatePolicy(def: ModelDefinition, instance: any): void {
  if (isSystem()) return // trusted scope (seeding/crons/login audit) bypasses
  const policy = getPolicy(def)
  const appPolicy = getAppPolicy(def.app)
  const createRule = policy?.create ?? appPolicy?.create
  const onCreate = policy?.onCreate ?? appPolicy?.onCreate
  if (!createRule && !onCreate && !def.secure) return
  const ctx = policyContext()
  if (createRule) {
    if (!createRule(ctx)) throw new ForbiddenError(`Not permitted to create "${def.tableName}".`)
  } else if (def.secure) {
    throw new ForbiddenError(
      `"${def.tableName}": create denied (secure model has no \`create\` policy).`
    )
  }
  onCreate?.(ctx, instance)
}

function applyCreateDefaults(def: ModelDefinition, instance: any): void {
  enforceCreatePolicy(def, instance)
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

  // Atomic: preSave → write → postSave commit or roll back together, so a failing
  // hook (e.g. a postSave audit/outbox write) undoes the row. `transaction()` is
  // reentrant — a save nested inside an outer `transaction()` joins it rather than
  // opening a second one.
  await getDatabase().transaction(async () => {
   const db = getDatabase()
   if (!db.skipSignals) await signals.preSave.emit({instances: [instance], created, model})

   try {
    if (!created) {
      // Row-level write authorization: AND the `update` policy into the WHERE. A
      // persisted instance always existed, so 0 affected rows ⇒ the policy
      // rejected it → ForbiddenError (not a silent no-op, not a NotFound mask).
      const outcome = isSystem() ? 'allow' : policyOutcome(def, 'update')
      if (outcome === 'deny') throw new ForbiddenError(`Not permitted to update "${def.tableName}".`)
      const scope: Scope = {def, ref: def.tableName, qualify: false}
      const withPolicy = (q: any) =>
        outcome === 'allow' ? q : q.where((eb: any) => compileWhere(eb, scope, outcome, {n: 0}))

      const data = rowFromInstance(def, instance, {includePrimaryKey: false})
      const pkVal = (instance as any)[pk!.propertyKey]
      // RETURNING refreshes the instance from the row — so a field set to
      // `undefined` (omitted from the SET) is healed back to its DB value rather
      // than left stale. An empty SET (nothing to write) re-reads instead.
      const row = Object.keys(data).length
        ? await withPolicy(
            db.kysely.updateTable(def.tableName).set(data).where(pk!.columnName, '=', pkVal)
          )
            .returningAll()
            .executeTakeFirst()
        : await withPolicy(
            db.kysely.selectFrom(def.tableName).select(selectableColumns(def)).where(pk!.columnName, '=', pkVal)
          ).executeTakeFirst()
      if (!row && outcome !== 'allow') {
        throw new ForbiddenError(`Not permitted to update "${def.tableName}".`)
      }
      if (row) copyRowOnto(def, instance, row)
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
      copyRowOnto(def, instance, inserted) // pull back identity PKs, DB defaults
      persisted.add(instance)
    }
   } catch (err) {
     // A unique violation (23505) → a precise `'unique'` field error, so a
     // duplicate surfaces as a userError instead of a masked "Unexpected error".
     const ve = uniqueViolation(def, err)
     if (ve) throw ve
     throw err
   }

   if (!db.skipSignals) await signals.postSave.emit({instances: [instance], created, model})
  })
  return instance
}

export async function deleteInstance(instance: object): Promise<void> {
  const def = getModelDefinitionOrThrow(instance.constructor)
  const pk = def.primaryKey
  if (!pk) {
    throw new Error(`Cannot delete "${def.tableName}": no primary key defined.`)
  }
  const model = instance.constructor as Function

  // Row-level delete authorization (mirrors the update path): AND the `delete`
  // policy into the WHERE; a persisted instance that deletes 0 rows ⇒ forbidden.
  const outcome = isSystem() ? 'allow' : policyOutcome(def, 'delete')
  if (outcome === 'deny') throw new ForbiddenError(`Not permitted to delete "${def.tableName}".`)

  // Atomic: preDelete → DELETE → postDelete (reentrant — joins an ambient txn).
  await getDatabase().transaction(async () => {
    const db = getDatabase()
    await signals.preDelete.emit({instances: [instance], model})
    let q: any = db.kysely
      .deleteFrom(def.tableName)
      .where(pk.columnName, '=', (instance as any)[pk.propertyKey])
    if (outcome !== 'allow') {
      const scope: Scope = {def, ref: def.tableName, qualify: false}
      q = q.where((eb: any) => compileWhere(eb, scope, outcome, {n: 0}))
    }
    const res = await q.executeTakeFirst()
    if (Number(res?.numDeletedRows ?? 0) === 0 && outcome !== 'allow') {
      throw new ForbiddenError(`Not permitted to delete "${def.tableName}".`)
    }
    persisted.delete(instance)
    await signals.postDelete.emit({instances: [instance], model})
  })
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
  const emit = options.signals ?? !getDatabase().skipSignals
  const model = ctor as Function

  const instances = values.map(v => {
    // Finalized class — see `hydrate` (resilient to duplicate bundle copies).
    const inst = new (def.ctor as typeof ctor)()
    assignDefined(inst, v)
    applyCreateDefaults(def, inst as any)
    const issues = validateInstance(def, inst as object)
    if (issues.length > 0) throw new ValidationError(issues)
    return inst
  })

  // NOTE: a bulk insert is a SINGLE atomic statement, so it isn't wrapped in its
  // own transaction (that would add BEGIN/COMMIT round-trips to the throughput
  // path). preSave/postSave fire once around it; if a hook needs the row write to
  // roll back with it, call createMany inside an explicit `transaction()`.
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
  const emit = options.signals ?? !getDatabase().skipSignals
  const model = (instances[0] as object).constructor as Function
  // Single atomic DELETE statement — not self-wrapped (see createMany note).
  if (emit) await signals.preDelete.emit({instances, model})
  await getDatabase()
    .kysely.deleteFrom(def.tableName)
    .where(pk.columnName, 'in', instances.map(i => (i as any)[pk.propertyKey]) as any)
    .execute()
  for (const i of instances) persisted.delete(i as object)
  if (emit) await signals.postDelete.emit({instances, model})
}
