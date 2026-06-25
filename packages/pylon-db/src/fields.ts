import {type Connection, createManager, ModelCtor, readPolicyDenies} from './manager.js'
import {registerModelAbilities, type ModelAbilitiesFn} from './abilities.js'
import {ForbiddenError} from './features.js'
import type {QueryConfig} from './query-schema.js'
import {
  asPaginated,
  loadBelongsTo,
  loadHasOne,
  ManyToManyManager,
  type Relation,
  RelatedManager
} from './relations.js'
import {
  ColumnDefinition,
  finalizeModel,
  getModelDefinition,
  getModelDefinitionOrThrow,
  ModelIndex,
  OnDelete,
  registerColumn,
  registerRelation,
  RelationDefinition,
  SqlType
} from './registry.js'
import type {FieldSchema} from './standard-schema.js'
import {snakeCase} from './util.js'

// ===========================================================================
// Field builders
// ---------------------------------------------------------------------------
// A field is declared as a class-field *initializer*:
//
//   class User extends Model {
//     id = id()
//     email = text({unique: true})
//     posts = hasMany(() => Post, {foreignKey: 'authorId'})
//   }
//
// Each builder returns a descriptor object at runtime, but its *type* is the
// column's value type (`text()` is typed `string`). The `@model()` decorator
// harvests the descriptors by probing a throwaway instance, then a wrapper
// subclass replaces them with real values on every construction so instances
// stay honest (`new User().email === undefined`, defaults applied).
// ===========================================================================

export interface FieldOptions {
  /** Override the column name. */
  column?: string
  unique?: boolean
  /** Create a secondary (non-unique) index on this column. */
  index?: boolean
  nullable?: boolean
  primaryKey?: boolean
  /** Literal default applied client-side on insert. */
  default?: unknown
  /** Raw SQL default, e.g. `now()`. */
  defaultSql?: string
  /** A column CHECK expression, e.g. `price > 0` (references the column name). */
  check?: string
  /** Validation: min value (numbers) / min length (strings). */
  min?: number
  /** Validation: max value (numbers) / max length (strings). */
  max?: number
  /** Validation: string must match this pattern. */
  pattern?: RegExp
  /** Validation: string must be a valid email. */
  email?: boolean
  /** Validation: custom rule — return `true` or an error message. */
  validate?: (value: unknown) => true | string
  /**
   * Validation: a Standard Schema (Zod / Valibot / ArkType, …). Runs alongside
   * the built-in rules; the library owns the error message. The ORM never
   * imports the library — it only reads the standard `~standard` interface.
   */
  schema?: FieldSchema
  /** Force hidden from the generated GraphQL API. */
  hidden?: boolean
}

type NullableOpts = FieldOptions & {nullable: true}

/** Internal descriptor produced by a scalar field builder. */
class FieldBuilder {
  constructor(
    readonly sqlType: SqlType,
    readonly base: Partial<ColumnDefinition>,
    readonly options: FieldOptions & {length?: number; precision?: number; scale?: number; onUpdate?: () => unknown; enumValues?: readonly string[]; array?: boolean; generatedAs?: string; ftsLanguage?: string; requires?: 'postgres'}
  ) {}
}

/** Internal descriptor produced by a relation builder. */
class RelationBuilder {
  constructor(
    readonly kind: 'belongsTo' | 'hasOne' | 'hasMany' | 'manyToMany',
    readonly target: () => Function,
    readonly options: ForeignKeyOptions &
      HasOneOptions &
      HasManyOptions &
      ManyToManyOptions & {length?: number}
  ) {}
}

/**
 * Per-instance backing store for column values, behind the proxy's column traps.
 * Held under a non-enumerable Symbol so it never leaks into a spread / `JSON.stringify`.
 */
const COLUMN_STORE = Symbol('pylon.columns')

function field(
  sqlType: SqlType,
  base: Partial<ColumnDefinition>,
  options: FieldOptions & {length?: number; precision?: number; scale?: number; onUpdate?: () => unknown; enumValues?: readonly string[]; array?: boolean; generatedAs?: string; ftsLanguage?: string; requires?: 'postgres'}
): unknown {
  return new FieldBuilder(sqlType, base, options)
}

/** Auto-incrementing integer primary key. */
export function id(options: FieldOptions = {}): number {
  return field('bigint', {primaryKey: true, autoIncrement: true}, options) as number
}

/** UUID column (pass `{primaryKey: true}` for a uuid PK with a server default). */
export function uuid(options: NullableOpts): string | null
export function uuid(options?: FieldOptions): string
export function uuid(options: FieldOptions = {}): string | null {
  const base: Partial<ColumnDefinition> = {}
  // Postgres-specific (dialect override point): server-side uuid default.
  if (options.primaryKey) base.defaultSql = 'gen_random_uuid()'
  return field('uuid', base, options) as string | null
}

export function text(options: NullableOpts): string | null
export function text(options?: FieldOptions): string
export function text(options: FieldOptions = {}): string | null {
  return field('text', {}, options) as string | null
}

export function varchar(length: number, options: NullableOpts): string | null
export function varchar(length: number, options?: FieldOptions): string
export function varchar(length: number, options: FieldOptions = {}): string | null {
  return field('varchar', {}, {...options, length}) as string | null
}

export function int(options: NullableOpts): number | null
export function int(options?: FieldOptions): number
export function int(options: FieldOptions = {}): number | null {
  return field('integer', {}, options) as number | null
}

export function bigint(options: NullableOpts): number | null
export function bigint(options?: FieldOptions): number
export function bigint(options: FieldOptions = {}): number | null {
  return field('bigint', {}, options) as number | null
}

/** Options for {@link numeric} — `precision`/`scale` map to `numeric(p, s)`. */
export interface NumericOptions extends FieldOptions {
  /** Total significant digits (e.g. 12 in `Decimal(12, 2)`). */
  precision?: number
  /** Digits after the decimal point (e.g. 2 in `Decimal(12, 2)`). */
  scale?: number
}
export interface NullableNumericOptions extends NumericOptions {
  nullable: true
}
export function numeric(options: NullableNumericOptions): number | null
export function numeric(options?: NumericOptions): number
export function numeric(options: NumericOptions = {}): number | null {
  return field('numeric', {}, options) as number | null
}

export function boolean(options: NullableOpts): boolean | null
export function boolean(options?: FieldOptions): boolean
export function boolean(options: FieldOptions = {}): boolean | null {
  return field('boolean', {}, options) as boolean | null
}

export function timestamp(options: NullableOpts): Date | null
export function timestamp(options?: FieldOptions): Date
export function timestamp(options: FieldOptions = {}): Date | null {
  return field('timestamptz', {}, options) as Date | null
}

export function date(options: NullableOpts): Date | null
export function date(options?: FieldOptions): Date
export function date(options: FieldOptions = {}): Date | null {
  return field('date', {}, options) as Date | null
}

/**
 * A timestamp set once on insert — Prisma's `@default(now())` for `createdAt`.
 * Filled client-side (`new Date()`) AND backed by a DB default (`now()`), so
 * adding the column to an existing (populated) table backfills its rows and
 * direct-SQL inserts still get a value. Override with `{defaultSql: …}`.
 */
export function createdAt(options: FieldOptions = {}): Date {
  return field('timestamptz', {}, {
    ...options,
    default: () => new Date(),
    defaultSql: options.defaultSql ?? 'now()'
  }) as Date
}

/**
 * A timestamp set on insert AND re-stamped on every update — Prisma's
 * `@updatedAt`. `default` fills it on insert, `onUpdate` re-runs it on every
 * write, and a DB default (`now()`) backfills column-adds / direct-SQL inserts.
 */
export function updatedAt(options: FieldOptions = {}): Date {
  return field('timestamptz', {}, {
    ...options,
    default: () => new Date(),
    defaultSql: options.defaultSql ?? 'now()',
    onUpdate: () => new Date()
  }) as Date
}

export function json<T = unknown>(options: NullableOpts): T | null
export function json<T = unknown>(options?: FieldOptions): T
export function json<T = unknown>(options: FieldOptions = {}): T | null {
  return field('jsonb', {}, options) as T | null
}

/** A string-valued TS enum object (`enum X { A = 'a' }` compiles to this). */
type StringEnum = Record<string, string>

/**
 * An enum column. Pass a native (string) TS `enum` — the recommended form, since
 * its members are usable in backend code (`UserRole.ADMIN`) and the GraphQL enum
 * takes the enum's name — or a plain list of string values. Stored as `text`
 * with a `CHECK (… IN (…))` (portable; not a native Postgres enum type, which is
 * painful to migrate). The GraphQL enum itself is named by the type-checker from
 * the field's TS type; the ORM only contributes the column + constraint.
 *
 * ```ts
 * enum UserRole { SUPER_ADMIN = 'SUPER_ADMIN', ADMIN = 'ADMIN', USER = 'USER' }
 * role = enumOf(UserRole, {default: UserRole.USER})   // → `role: UserRole`
 * status = enumOf(['draft', 'live'] as const)         // → ad-hoc union enum
 * ```
 */
export function enumOf<E extends StringEnum>(
  enumObject: E,
  options?: NullableOpts
): E[keyof E] | null
export function enumOf<E extends StringEnum>(
  enumObject: E,
  options?: FieldOptions
): E[keyof E]
export function enumOf<const V extends string>(
  values: readonly V[],
  options?: NullableOpts
): V | null
export function enumOf<const V extends string>(
  values: readonly V[],
  options?: FieldOptions
): V
export function enumOf(
  source: StringEnum | readonly string[],
  options: FieldOptions = {}
): unknown {
  const values = Array.isArray(source)
    ? [...source]
    : Object.values(source as StringEnum)
  if (values.some(v => typeof v !== 'string')) {
    throw new Error(
      'enumOf requires string values — numeric/heterogeneous TS enums are not supported as DB enums.'
    )
  }
  return field('text', {}, {...options, enumValues: values as string[]})
}

/**
 * A Postgres array column built from an element field: `array(text())` → `text[]`
 * (GraphQL `[String!]`). The element provides the SQL type (and varchar length);
 * the array column's own options (nullable, default, …) come from `options`.
 *
 * ```ts
 * features = array(text())            // text[]
 * tags = array(varchar(50), {nullable: true})
 * ```
 */
export function array<E>(element: E, options: NullableOpts): E[] | null
export function array<E>(element: E, options?: FieldOptions): E[]
export function array<E>(element: E, options: FieldOptions = {}): E[] | null {
  const el = element as unknown as FieldBuilder
  if (!(el instanceof FieldBuilder)) {
    throw new Error('array(...) expects a field builder element, e.g. array(text()).')
  }
  return field(el.sqlType, {}, {length: el.options.length, ...options, array: true}) as E[] | null
}

// ===========================================================================
// Relation builders
// ===========================================================================

export interface ForeignKeyOptions extends FieldOptions {
  /** SQL type of the FK column; defaults to `bigint` (matches `id()`). */
  type?: SqlType
  /**
   * Name of the lazy accessor property. Defaults to the declared property with
   * a trailing `Id` stripped (`authorId` → `author`).
   */
  accessor?: string
  /** ON DELETE behavior for the generated FK constraint. */
  onDelete?: OnDelete
}

/**
 * Many-to-one foreign key. Assign to the FK *scalar* property (e.g. `authorId`):
 * this registers the `author_id` column and installs a lazy, batched accessor
 * (named `author`) that resolves to the related instance. Declare the accessor
 * type alongside it:
 *
 * ```ts
 * authorId = foreignKey(() => Author)
 * declare author: Relation<Author>
 * ```
 */
/**
 * The scalar type of the FK target's primary key. Inferred precisely when the
 * PK is named `id` (the convention — and what Prisma/most ORMs default to);
 * for a differently-named PK it widens to `string | number` (safe, just loose —
 * the runtime always resolves the *actual* PK type regardless of its name).
 */
type IdOf<R> = R extends {id: infer I} ? Exclude<I, null> : string | number

export function foreignKey<R extends object>(
  target: () => ModelCtor<R>,
  options: ForeignKeyOptions & {nullable: true}
): IdOf<R> | null
export function foreignKey<R extends object>(
  target: () => ModelCtor<R>,
  options?: ForeignKeyOptions
): IdOf<R>
export function foreignKey<R extends object>(
  target: () => ModelCtor<R>,
  options: ForeignKeyOptions = {}
): IdOf<R> | null {
  return new RelationBuilder(
    'belongsTo',
    target as () => Function,
    options as ForeignKeyOptions & HasManyOptions
  ) as unknown as IdOf<R> | null
}

/**
 * A PAGINATED relation accessor: instead of a list, the GraphQL field takes Relay
 * args and returns a `Connection`. Declared by `{paginate: true}`. At the type
 * level it's a callable so the compiler emits `field(first, after, last, before):
 * TConnection`; at runtime it's a prototype method that calls the manager's
 * `.paginate()` scoped to the parent row.
 */
// A paginated relation accessor: CALLABLE (Relay args → `Connection`, which is what
// the compiler reads off the call signature to emit `field(first, …): TConnection`)
// AND exposing the manager's methods, so programmatic reads/writes
// (`post.tags.add(...)`, `.all()`, `await post.tags`) stay typed. The runtime backs
// this with a callable Proxy over the manager (`asPaginated`).
//
// Why a hand-listed interface (not `extends RelatedManager` / an intersection):
//  - it must be a SINGLE interface with a call signature — an INTERSECTION
//    suppresses the call signature, so the compiler emits the alias name instead
//    of the Connection;
//  - it must NOT be Array-shaped — `RelatedManager`/`ManyToManyManager` extend
//    `Array`, and a relation field of that shape is matched by `WhereInput`'s
//    to-many key set, whose `ToManyFilter<WhereInput<target>>` recurses through
//    this type's `Connection<R>` return type and trips TS's circular-reference
//    guard on any bidirectional relation graph (→ a broken `WhereInput`).
// Methods are referenced by indexed access so their signatures never drift.
export interface PaginatedHasMany<R extends object> {
  (first?: number, after?: string, last?: number, before?: string, skip?: number, query?: string): Promise<Connection<R>>
  all: RelatedManager<R>['all']
  filter: RelatedManager<R>['filter']
  orderBy: RelatedManager<R>['orderBy']
  limit: RelatedManager<R>['limit']
  first: RelatedManager<R>['first']
  get: RelatedManager<R>['get']
  count: RelatedManager<R>['count']
  create: RelatedManager<R>['create']
  createMany: RelatedManager<R>['createMany']
  set: RelatedManager<R>['set']
  paginate: RelatedManager<R>['paginate']
  then: RelatedManager<R>['then']
}
export interface PaginatedManyToMany<R extends object> {
  (first?: number, after?: string, last?: number, before?: string, skip?: number): Promise<Connection<R>>
  all: ManyToManyManager<R>['all']
  count: ManyToManyManager<R>['count']
  add: ManyToManyManager<R>['add']
  remove: ManyToManyManager<R>['remove']
  clear: ManyToManyManager<R>['clear']
  set: ManyToManyManager<R>['set']
  paginate: ManyToManyManager<R>['paginate']
  then: ManyToManyManager<R>['then']
}

export interface HasManyOptions {
  /** The FK *property* on the target model that references this model. */
  foreignKey: string
  /**
   * Expose this relation as a Relay `Connection` (cursor-paginated) instead of a
   * plain list — the GraphQL field gains `first/after/last/before` args and
   * returns `TConnection`. Programmatic access becomes `parent.field(first, …)`
   * (or `parent.field().` defaults). NOTE: a paginated relation is not
   * N+1-batched (each parent's page is its own keyset query).
   */
  paginate?: boolean
}

/**
 * Reverse one-to-many. Assign to a property; it resolves to a `RelatedManager`
 * scoped to the parent's primary key — or, with `{paginate: true}`, to a
 * cursor-paginated `Connection` accessor.
 *
 * ```ts
 * posts = hasMany(() => Post, {foreignKey: 'authorId'})
 * pagedPosts = hasMany(() => Post, {foreignKey: 'authorId', paginate: true})
 * ```
 */
export function hasMany<R extends object>(
  target: () => ModelCtor<R>,
  options: HasManyOptions & {paginate: true}
): PaginatedHasMany<R>
export function hasMany<R extends object>(
  target: () => ModelCtor<R>,
  options: HasManyOptions
): RelatedManager<R>
export function hasMany<R extends object>(
  target: () => ModelCtor<R>,
  options: HasManyOptions
): RelatedManager<R> | PaginatedHasMany<R> {
  return new RelationBuilder(
    'hasMany',
    target as () => Function,
    options as ForeignKeyOptions & HasManyOptions & ManyToManyOptions
  ) as unknown as RelatedManager<R>
}

export interface HasOneOptions {
  /** The FK *property* on the target model that references this model. */
  foreignKey: string
}

/**
 * Reverse ONE-to-one. The inverse of a unique foreign key: the owning side holds
 * `foreignKey(() => T, {unique: true})`, this side navigates back to the single
 * related row (or `null`). Resolves to a `Relation<R>` (a `Promise<R | null>`),
 * batched like `hasMany`.
 *
 * ```ts
 * // Account (owning): userId = foreignKey(() => User, {unique: true})
 * // User (inverse):
 * account = hasOne(() => Account, {foreignKey: 'userId'})  // → account: Account
 * ```
 */
export function hasOne<R extends object>(
  target: () => ModelCtor<R>,
  options: HasOneOptions
): Relation<R> {
  return new RelationBuilder(
    'hasOne',
    target as () => Function,
    options as ForeignKeyOptions & HasOneOptions & HasManyOptions & ManyToManyOptions
  ) as unknown as Relation<R>
}

export interface ManyToManyOptions {
  /**
   * Explicit join-table name. Defaults to both tables sorted and joined with
   * `_` (e.g. `post` + `tag` → `post_tag`), so both relation sides agree
   * without coordination.
   */
  through?: string
  /**
   * Join column referencing THIS model. Defaults to `<table>_<pk>`. Set this
   * (with `through`/`targetColumn`) to bind to an existing join table whose
   * columns don't follow the default convention — e.g. Prisma's `A`/`B`.
   */
  sourceColumn?: string
  /** Join column referencing the TARGET model. Defaults to `<table>_<pk>`. */
  targetColumn?: string
  /**
   * Mark this as the INVERSE side: it gives a read/write accessor over the join
   * table the OTHER side owns, but does NOT synthesize/create the table itself.
   * Required when the two endpoints live in **different apps** (each app
   * synthesizes its own migrations, so without this both would `createTable` the
   * shared join → a deploy collision). Declare the canonical side normally and
   * the other side `{inverse: true}`.
   */
  inverse?: boolean
  /**
   * Expose this relation as a Relay `Connection` (cursor-paginated) instead of a
   * plain list — see {@link HasManyOptions.paginate}. Paginates THROUGH the join
   * table, keyset on the target's PK by default.
   */
  paginate?: boolean
}

/**
 * Many-to-many. Declare it on *both* sides; a join table is synthesized (two
 * FK columns + a composite UNIQUE index) and shared by both. Resolves to a
 * {@link ManyToManyManager} scoped to the parent row — or, with
 * `{paginate: true}`, to a cursor-paginated `Connection` accessor.
 *
 * ```ts
 * // on Post
 * tags = manyToMany(() => Tag)
 * // on Tag
 * posts = manyToMany(() => Post)
 * ```
 */
export function manyToMany<R extends object>(
  target: () => ModelCtor<R>,
  options: ManyToManyOptions & {paginate: true}
): PaginatedManyToMany<R>
export function manyToMany<R extends object>(
  target: () => ModelCtor<R>,
  options?: ManyToManyOptions
): ManyToManyManager<R>
export function manyToMany<R extends object>(
  target: () => ModelCtor<R>,
  options: ManyToManyOptions = {}
): ManyToManyManager<R> | PaginatedManyToMany<R> {
  return new RelationBuilder(
    'manyToMany',
    target as () => Function,
    options as ForeignKeyOptions & HasManyOptions & ManyToManyOptions
  ) as unknown as ManyToManyManager<R>
}

// ===========================================================================
// @model() — harvest descriptors, install accessors, finalize the model
// ===========================================================================

export interface ModelOptions {
  /** Override the table name (defaults to snake_case of the class name). */
  table?: string
  /** Abstract base model: contributes columns to subclasses but has no table. */
  abstract?: boolean
  /** Migration-group / app this model belongs to. Prefer `models.app(name)`. */
  app?: string
  /** Property name of the tenant FK for auto-scoping. Prefer `models.app(name,{tenant})`. */
  tenant?: string
  /**
   * Deny-by-default authorization. With `secure: true`, any action (read /
   * create / update / delete) that has no matching rule in `definePolicy()` is
   * rejected. Without it, an action with no rule is allowed (policies are
   * additive restrictions). Use for high-stakes models where forgetting a rule
   * should fail closed, not open.
   */
  secure?: boolean
  /**
   * Composite (multi-column) secondary indexes. `columns` are property names.
   * Single-column indexes use the field option `{index: true}`; a composite
   * unique constraint is `{columns: [...], unique: true}`.
   */
  indexes?: ModelIndex[]
  /**
   * Full-text search (Postgres). Synthesizes a hidden, STORED-generated
   * `tsvector` column from the given property columns (kept in sync with no
   * triggers) plus a GIN index — search infrastructure, never a GraphQL field.
   * Query it with `Model.objects.search(text)`.
   *
   * Pass an array for multiple independent search sets (each its own column +
   * GIN index); target one with `.search(text, {column: 'titleFts'})`.
   *
   * ```ts
   * @model({search: {columns: ['title', 'body'], language: 'german'}})
   * @model({search: [
   *   {name: 'titleFts', columns: ['title']},
   *   {name: 'bodyFts',  columns: ['body']}
   * ]})
   * ```
   */
  search?: SearchOptions | SearchOptions[]
  /**
   * Trigram (substring) search (Postgres `pg_trgm`). Creates a `gin_trgm_ops`
   * GIN index on each named text column — and ensures the `pg_trgm` extension —
   * so a `contains` filter (`ILIKE '%x%'`) on that column becomes index-backed
   * instead of a sequential scan. Use this where FTS can't help: matching a
   * fragment *inside* a token (SKUs, serials, handles, emails), since FTS only
   * matches whole words / prefixes.
   *
   * Unlike `search`, this synthesizes NO column — it indexes the existing
   * column directly, and needs no query-side change (`{contains}` already maps
   * to `ILIKE`, which the planner accelerates with this index).
   *
   * ```ts
   * @model({trigram: {columns: ['sku', 'handle']}})
   * ```
   */
  trigram?: TrigramOptions
  /**
   * Query/filter configuration for the Shopify-style `query` DSL (and the future
   * typed `where` input). Adds **virtual/derived fields** (a named predicate over
   * relations or computed buckets) and a **public allowlist** that curates which
   * fields a public consumer may query.
   *
   * ```ts
   * @model({
   *   query: {
   *     fields: {
   *       vendor: {path: 'product.vendorId'},                       // alias / re-path
   *       inStock: {toWhere: (_op, v) => ({                         // virtual
   *         inventoryItems: {some: {available: {gt: 0}}}
   *       })},
   *     },
   *     public: ['title', 'vendor', 'inStock'],                     // curated public surface
   *   },
   * })
   * ```
   */
  query?: QueryConfig
}

/** Full-text search config for `@model({search})`. */
export interface SearchOptions {
  /** Property names whose columns feed the search vector. */
  columns: string[]
  /** Postgres text-search config (e.g. `english`, `german`). Default `english`. */
  language?: string
  /** Generated column name (default `fts`; required when there are several). */
  name?: string
}

/** Trigram substring-search config for `@model({trigram})`. */
export interface TrigramOptions {
  /** Property names (text columns) to give a `gin_trgm_ops` index. */
  columns: string[]
}

/** A model's column property names — the surface `ModelConfig` type-checks against. */
type ColumnKey<T> = Extract<keyof T, string>

interface ModelSearchConfig<T> {
  columns: ColumnKey<T>[]
  language?: string
  name?: string
}

/**
 * Typed model configuration, declared as `static config = {...} satisfies
 * ModelConfig<T>`. Same shape as the `@model()` decorator options, but `tenant`,
 * `indexes`, `search`, and `trigram` reference the model's OWN fields — so a mistyped
 * column name is a compile error, not a silent miss. Decorator args still work and
 * take precedence, so the two forms compose. (`app` is set by the binding —
 * `@app.model()` / `models.app(name)` — not here.)
 */
export interface ModelConfig<T> {
  table?: string
  abstract?: boolean
  secure?: boolean
  tenant?: ColumnKey<T>
  indexes?: Array<{columns: ColumnKey<T>[]; unique?: boolean}>
  search?: ModelSearchConfig<T> | ModelSearchConfig<T>[]
  trigram?: {columns: ColumnKey<T>[]}
  query?: QueryConfig<T>
}

// Mirror the runtime validator's type buckets (validation.ts) so a DB CHECK and
// the JS rule agree on what `min`/`max` mean: numeric value bounds vs string
// length bounds.
const CHECK_NUMBER_TYPES = new Set<SqlType>(['integer', 'bigint', 'numeric'])
const CHECK_STRING_TYPES = new Set<SqlType>(['text', 'varchar', 'uuid'])

/**
 * Compose a single column CHECK from the field's constraints — the DB-level
 * backstop for the SAME `min`/`max`/enum rules the runtime validator enforces
 * (defense-in-depth: the validator fails fast with structured errors for ORM
 * writes; the CHECK still protects against raw SQL and non-ORM writers).
 *
 * Only rules whose SQL is provably equivalent to the JS validator are projected:
 * numeric `min`/`max` as value bounds, string `min`/`max` as `char_length`
 * bounds, and enum membership as `IN (…)`. `pattern`/`email` are deliberately
 * NOT projected — a JS `RegExp` does not translate faithfully to Postgres POSIX
 * regex, so a DB CHECK could diverge from the app rule (a value accepted in one
 * place, rejected in the other); they stay JS-only. A CHECK passes when the
 * column is NULL, so nullable columns need no special-casing. (`char_length`
 * counts code points vs JS `.length`'s UTF-16 units — they differ only for
 * non-BMP characters, an acceptable edge for a length bound.)
 */
function buildCheck(
  columnName: string,
  sqlType: SqlType,
  options: FieldOptions & {enumValues?: readonly string[]}
): string | undefined {
  const col = `"${columnName}"`
  const clauses: string[] = []
  if (options.enumValues) {
    clauses.push(`${col} IN (${options.enumValues.map(v => `'${v.replace(/'/g, "''")}'`).join(', ')})`)
  }
  if (CHECK_NUMBER_TYPES.has(sqlType)) {
    if (options.min !== undefined) clauses.push(`${col} >= ${options.min}`)
    if (options.max !== undefined) clauses.push(`${col} <= ${options.max}`)
  } else if (CHECK_STRING_TYPES.has(sqlType)) {
    if (options.min !== undefined) clauses.push(`char_length(${col}) >= ${options.min}`)
    if (options.max !== undefined) clauses.push(`char_length(${col}) <= ${options.max}`)
  }
  // An explicit `check` is author-controlled — appended verbatim.
  if (options.check) clauses.push(options.check)

  if (clauses.length === 0) return undefined
  if (clauses.length === 1) return clauses[0]
  return clauses.map(c => `(${c})`).join(' AND ')
}

function buildColumn(key: string, b: FieldBuilder): ColumnDefinition {
  // A `$`-prefixed property is hidden from the generated GraphQL API: `$` is not
  // a valid GraphQL field-name character, so Pylon's schema builder excludes the
  // member entirely. The column still persists; the `$` is stripped for the
  // column name (`$passwordHash` → `password_hash`).
  const hidden = b.options.hidden ?? key.startsWith('$')
  const exposedName = key.startsWith('$') ? key.slice(1) : key
  const columnName = b.options.column ?? snakeCase(exposedName)
  // Project enum membership + numeric/string min/max (and any explicit check)
  // into a single DB CHECK — the DB-level backstop for the runtime validator.
  const check = buildCheck(columnName, b.sqlType, b.options)
  return {
    propertyKey: key,
    columnName,
    sqlType: b.sqlType,
    primaryKey: b.options.primaryKey ?? b.base.primaryKey ?? false,
    autoIncrement: b.base.autoIncrement ?? false,
    unique: b.options.unique ?? b.base.unique ?? false,
    nullable: b.options.nullable ?? false,
    hidden,
    index: b.options.index ?? false,
    length: b.options.length,
    precision: b.options.precision,
    scale: b.options.scale,
    onUpdateFn: b.options.onUpdate,
    generatedAs: b.options.generatedAs,
    ftsLanguage: b.options.ftsLanguage,
    requires: b.options.requires,
    // A literal default is persisted (→ IR/DDL); a function default is a
    // client-side generator resolved at insert (never serialized).
    default: typeof b.options.default === 'function' ? undefined : b.options.default,
    defaultFn:
      typeof b.options.default === 'function'
        ? (b.options.default as () => unknown)
        : undefined,
    defaultSql: b.options.defaultSql ?? b.base.defaultSql,
    check,
    min: b.options.min,
    max: b.options.max,
    pattern: b.options.pattern,
    email: b.options.email,
    enumValues: b.options.enumValues,
    validate: b.options.validate,
    schema: b.options.schema,
    array: b.options.array
  }
}

/**
 * Register the column/relation a single field initializer declares, into the pending
 * registry for `Ctor`. Returns the RelationDefinition (so the caller can install its
 * accessor) or `undefined` for a plain scalar column. Shared by the `@model` decorator
 * (probe-iteration over own props) and the decorator-free `app.model(...)` path
 * (proxy trap-capture) — both feed the SAME registry, so the IR is identical.
 */
function harvestMember(
  Ctor: Function,
  key: string,
  value: unknown
): RelationDefinition | undefined {
  if (value instanceof FieldBuilder) {
    registerColumn(Ctor, buildColumn(key, value))
    return undefined
  }
  if (!(value instanceof RelationBuilder)) return undefined
  if (value.kind === 'belongsTo') {
    const fkProperty = key
    const fkColumn = value.options.column ?? snakeCase(fkProperty)
    // The FK is a normal scalar column (filterable, hydrated like any other).
    registerColumn(Ctor, {
      propertyKey: fkProperty,
      columnName: fkColumn,
      sqlType: value.options.type ?? 'bigint',
      fkInferType: value.options.type === undefined,
      primaryKey: false,
      autoIncrement: false,
      unique: value.options.unique ?? false,
      nullable: value.options.nullable ?? false,
      hidden: value.options.hidden ?? false,
      default: undefined,
      defaultSql: undefined
    })
    const accessor =
      value.options.accessor ??
      (fkProperty.endsWith('Id') ? fkProperty.slice(0, -2) : `${fkProperty}Ref`)
    const rel: RelationDefinition = {
      kind: 'belongsTo',
      propertyKey: accessor,
      target: value.target,
      nullable: value.options.nullable ?? false,
      fkProperty,
      fkColumn,
      onDelete: value.options.onDelete
    }
    registerRelation(Ctor, rel)
    return rel
  }
  if (value.kind === 'manyToMany') {
    const rel: RelationDefinition = {
      kind: 'manyToMany',
      propertyKey: key,
      target: value.target,
      nullable: true,
      through: value.options.through,
      sourceColumn: value.options.sourceColumn,
      targetColumn: value.options.targetColumn,
      inverse: value.options.inverse,
      paginate: value.options.paginate
    }
    registerRelation(Ctor, rel)
    return rel
  }
  if (value.kind === 'hasOne') {
    const rel: RelationDefinition = {
      kind: 'hasOne',
      propertyKey: key,
      target: value.target,
      nullable: true,
      targetForeignKey: value.options.foreignKey
    }
    registerRelation(Ctor, rel)
    return rel
  }
  const rel: RelationDefinition = {
    kind: 'hasMany',
    propertyKey: key,
    target: value.target,
    nullable: true,
    targetForeignKey: value.options.foreignKey,
    paginate: value.options.paginate
  }
  registerRelation(Ctor, rel)
  return rel
}

/**
 * Install the lazy relation accessors (belongsTo/hasOne/hasMany/manyToMany) on a
 * prototype. Extracted from the `@model` decorator so both paths share it: the
 * decorator installs on its `Wrapped.prototype`; the decorator-free path installs on
 * the user class's own prototype (proxy instances reach it because the trap never lets
 * the relation builder become an own prop that would shadow it).
 */
function installRelationAccessors(proto: any, relations: RelationDefinition[]): void {
  for (const rel of relations) {
    if (rel.kind === 'belongsTo') {
      const {fkProperty, target} = rel
      Object.defineProperty(proto, rel.propertyKey, {
        configurable: true,
        enumerable: false,
        get(this: any) {
          const fk = this[fkProperty!]
          if (fk === null || fk === undefined) return Promise.resolve(null)
          const targetCtor = target() as ModelCtor<any>
          return loadBelongsTo(targetCtor, fk).then(row => {
            if (row !== null) return row
            // The FK is set but the target row didn't resolve. For a NULLABLE
            // relation, null is a valid answer. For a NON-NULL relation this would
            // otherwise surface as GraphQL's opaque "Cannot return null for
            // non-nullable field <T>.<rel>" — so raise a precise error instead.
            // The usual cause is the target's READ policy denying the traversal
            // (a no-principal/cross-tenant read) → ForbiddenError; otherwise it's
            // a dangling foreign key.
            const srcDef = getModelDefinitionOrThrow(this.constructor)
            const fkNullable =
              srcDef.columns.find(c => c.propertyKey === fkProperty)?.nullable ??
              false
            if (fkNullable) return null
            const targetDef = getModelDefinitionOrThrow(targetCtor)
            if (readPolicyDenies(targetDef)) {
              throw new ForbiddenError(
                `Not authorized to read "${targetDef.tableName}" through relation ` +
                  `"${rel.propertyKey}".`
              )
            }
            throw new Error(
              `Relation "${rel.propertyKey}" references ${targetDef.tableName} ` +
                `"${String(fk)}", but no such row resolved (dangling foreign key, ` +
                `row-level policy, or a different tenant).`
            )
          })
        }
      })
    } else if (rel.kind === 'hasOne') {
      // Inverse 1:1 — resolve the single child whose FK points at this row's PK
      // (batched like hasMany, takes the first). Returns Promise<T | null>.
      const {target, targetForeignKey} = rel
      Object.defineProperty(proto, rel.propertyKey, {
        configurable: true,
        enumerable: false,
        get(this: any) {
          const def = getModelDefinitionOrThrow(this.constructor)
          const pkProperty = def.primaryKey?.propertyKey
          if (!pkProperty) {
            throw new Error(
              `Cannot resolve hasOne "${rel.propertyKey}": "${def.tableName}" has no primary key.`
            )
          }
          const targetCtor = target() as ModelCtor<any>
          const targetDef = getModelDefinitionOrThrow(targetCtor)
          const fkColumn =
            targetDef.columns.find(c => c.propertyKey === targetForeignKey)?.columnName ??
            targetForeignKey!
          return loadHasOne(targetCtor, fkColumn, this[pkProperty])
        },
        set() {
          /* no-op: relation is a computed accessor, not stored state */
        }
      })
    } else if (rel.kind === 'manyToMany') {
      const {target, through, sourceColumn, targetColumn, paginate} = rel
      const makeManager = (self: any): ManyToManyManager<any> => {
        const def = getModelDefinitionOrThrow(self.constructor)
        const pkProperty = def.primaryKey?.propertyKey
        if (!pkProperty) {
          throw new Error(
            `Cannot resolve manyToMany "${rel.propertyKey}": "${def.tableName}" has no primary key.`
          )
        }
        return new ManyToManyManager(
          self.constructor as ModelCtor<any>,
          target() as ModelCtor<any>,
          self[pkProperty],
          {through, sourceColumn, targetColumn}
        )
      }
      // Paginated → a getter returning a callable manager (Relay args →
      // Connection when called; `.add()/.all()/await` still reach the manager).
      // Plain → a getter returning the (thenable, list-shaped) manager.
      Object.defineProperty(proto, rel.propertyKey, {
        configurable: true,
        enumerable: false,
        get(this: any) {
          const mgr = makeManager(this)
          return paginate ? asPaginated(mgr) : mgr
        },
        set() {
          /* no-op: relation is a computed accessor, not stored state */
        }
      })
    } else {
      const {target, targetForeignKey, paginate} = rel
      const makeManager = (self: any): RelatedManager<any> => {
        const def = getModelDefinitionOrThrow(self.constructor)
        const pkProperty = def.primaryKey?.propertyKey
        if (!pkProperty) {
          throw new Error(
            `Cannot resolve hasMany "${rel.propertyKey}": "${def.tableName}" has no primary key.`
          )
        }
        return new RelatedManager(target() as ModelCtor<any>, targetForeignKey!, self[pkProperty])
      }
      Object.defineProperty(proto, rel.propertyKey, {
        configurable: true,
        enumerable: false,
        get(this: any) {
          const mgr = makeManager(this)
          // Pass the target def so `asPaginated` can parse the `query` arg.
          return paginate ? asPaginated(mgr, getModelDefinitionOrThrow(target() as ModelCtor<any>)) : mgr
        },
        // Swallow the field-initializer write: `posts = hasMany(...)` runs in
        // the constructor and would otherwise throw ("has only a getter").
        set() {
          /* no-op: relation is a computed accessor, not stored state */
        }
      })
    }
  }
}

// ── Proxy model path ─────────────────────────────────────────────────────────
// The `Model` base returns `new Proxy(this, modelHandler)` for EVERY model. Field-init
// `[[Define]]`/`[[Set]]` of builders is swallowed by the traps and harvested to the
// registry, so a plain `class Post extends Model { id = id() }` needs no `Wrapped`
// subclass and no binding replacement. Columns read/write the per-instance COLUMN_STORE;
// relation accessors live on the class prototype (installed by `finalizeProxyModel`) and
// show through because the trap never lets the relation builder become an own prop.

function proxyStore(t: any): Record<string, unknown> {
  let s = t[COLUMN_STORE] as Record<string, unknown> | undefined
  if (!s) {
    s = {}
    Object.defineProperty(t, COLUMN_STORE, {
      value: s,
      enumerable: false,
      writable: true,
      configurable: true
    })
  }
  return s
}

const isProxyColumn = (ctor: Function, k: PropertyKey): boolean =>
  typeof k === 'string' &&
  !!getModelDefinition(ctor)?.columns.some(c => c.propertyKey === k)

/**
 * Swallow a field-initializer builder → harvest schema (idempotent, only until the
 * model is finalized) + seed a literal default. MUST run in BOTH `set` and
 * `defineProperty` (class fields may compile to assignment, not `[[Define]]`), and
 * BEFORE the is-column store-write — else a re-run initializer would store the BUILDER
 * as the column value (DD §6.7). Returns true when the value was a builder (swallow).
 */
function captureBuilder(t: any, k: PropertyKey, v: unknown): boolean {
  if (typeof k !== 'string') return false
  if (!(v instanceof FieldBuilder) && !(v instanceof RelationBuilder)) return false
  const ctor = t.constructor as Function
  if (!getModelDefinition(ctor)) harvestMember(ctor, k, v) // harvest until finalized
  if (
    v instanceof FieldBuilder &&
    'default' in v.options &&
    typeof v.options.default !== 'function'
  ) {
    proxyStore(t)[k] = v.options.default
  }
  return true
}

export const modelHandler: ProxyHandler<any> = {
  defineProperty(t, k, desc) {
    if ('value' in desc && captureBuilder(t, k, (desc as PropertyDescriptor).value)) return true
    return Reflect.defineProperty(t, k, desc)
  },
  get(t, k, r) {
    if (isProxyColumn(t.constructor, k)) return proxyStore(t)[k as string]
    return Reflect.get(t, k, r) // relation accessors (prototype), methods, symbols
  },
  set(t, k, v, r) {
    if (captureBuilder(t, k, v)) return true // builder swallow takes precedence
    if (isProxyColumn(t.constructor, k)) {
      if (v !== undefined) proxyStore(t)[k as string] = v // ignore undefined ("not provided")
      return true
    }
    return Reflect.set(t, k, v, r)
  },
  has(t, k) {
    return isProxyColumn(t.constructor, k) || Reflect.has(t, k)
  },
  ownKeys(t) {
    const cols =
      getModelDefinition(t.constructor)
        ?.columns.filter(c => !c.hidden)
        .map(c => c.propertyKey) ?? []
    const real = Reflect.ownKeys(t).filter(x => typeof x === 'string' && !cols.includes(x))
    return [...cols, ...real]
  },
  getOwnPropertyDescriptor(t, k) {
    if (isProxyColumn(t.constructor, k))
      return {value: proxyStore(t)[k as string], writable: true, enumerable: true, configurable: true}
    return Reflect.getOwnPropertyDescriptor(t, k)
  },
  deleteProperty(t, k) {
    if (isProxyColumn(t.constructor, k)) {
      delete proxyStore(t)[k as string]
      return true
    }
    return Reflect.deleteProperty(t, k)
  }
}

/**
 * Finalize a plain (undecorated) model registered via `app.model(...)`: flag it for
 * proxy construction, probe once to harvest its columns/relations through the traps,
 * `finalizeModel`, install relation accessors on its OWN prototype, wire co-located
 * `static abilities`, and assign a default manager. The structural twin of the `@model`
 * decorator — minus the binding replacement (no `Wrapped`; same class identity).
 */
export function finalizeProxyModel(Ctor: Function, options: ModelOptions = {}): void {
  const existing = getModelDefinition(Ctor)
  if (existing) {
    // Idempotent for the SAME app (e.g. an HMR re-eval). A DIFFERENT app is a real
    // error: a model class binds to exactly one definition (one table, one manager),
    // so it belongs to exactly one app — to use it elsewhere, import the class.
    if ((existing.app ?? undefined) !== (options.app ?? undefined)) {
      throw new Error(
        `[pylon-db] Model "${Ctor.name}" is already registered to app ` +
          `"${existing.app ?? '(root)'}"; cannot re-register to "${options.app ?? '(root)'}". ` +
          'A model belongs to one app — import the class to use it from another.'
      )
    }
    return
  }

  // Merge the model's own `static config` (table/indexes/search/secure/tenant/…) with the
  // app-level binding the registrar passes (`app`, plus default `tenant`/`secure`). The app
  // owns `app`; the model's own config WINS for `tenant`/`secure` with the app value as the
  // fallback — so a passed `secure: undefined` (an app with no `db.secure`) never clobbers a
  // model's `static config.secure`.
  const staticConfig = ((Ctor as {config?: ModelOptions}).config ?? {}) as ModelOptions
  options = {
    ...staticConfig,
    ...options,
    tenant: staticConfig.tenant ?? options.tenant,
    secure: staticConfig.secure ?? options.secure
  }

  // A self-referential model (`static objects = manager(Author)`) compiles, under
  // `useDefineForClassFields:false` (required for the decorator path), to
  // `var Author = class _Author {…}` — so `Ctor.name` is the esbuild inner name
  // `_Author`. Strip that single leading underscore so the table/entity/GraphQL names
  // stay clean and match the TS type the compiler emits. (An intentional `_Foo` would
  // be mangled to `__Foo`, so stripping ONE underscore round-trips it correctly.)
  if (/^_[A-Za-z]/.test(Ctor.name)) {
    try {
      Object.defineProperty(Ctor, 'name', {value: Ctor.name.slice(1), configurable: true})
    } catch {
      /* name not configurable (frozen) — fall through with the mangled name */
    }
  }

  // Table name: an explicit `static config.table` wins; otherwise snake_case of the
  // class, prefixed by the app NAME when one is set (`blog` → `blog_post`, Django-style)
  // so composing multiple named apps can't collide on a shared table. An UNNAMED (root)
  // app doesn't prefix — the single-app common case keeps clean table names.
  const base = snakeCase(Ctor.name)
  const tableName =
    options.table ?? (options.app ? `${snakeCase(options.app)}_${base}` : base)
  const isAbstract = options.abstract ?? false

  new (Ctor as any)() // probe: field initializers run under the proxy → traps harvest

  finalizeModel(Ctor, {
    tableName,
    abstract: isAbstract,
    app: options.app,
    indexes: options.indexes,
    tenant: options.tenant,
    secure: options.secure,
    search: options.search,
    trigram: options.trigram,
    query: options.query
  })

  const def = getModelDefinitionOrThrow(Ctor)
  installRelationAccessors(Ctor.prototype, def.relations)

  if (!isAbstract) {
    const abilitiesFn = (Ctor as {abilities?: unknown}).abilities
    if (typeof abilitiesFn === 'function') {
      registerModelAbilities(Ctor as ModelCtor<any>, abilitiesFn as ModelAbilitiesFn)
    }
  }

  if (!isAbstract && !Object.prototype.hasOwnProperty.call(Ctor, 'objects')) {
    Object.defineProperty(Ctor, 'objects', {
      value: createManager(Ctor as any),
      writable: false,
      enumerable: false,
      configurable: true
    })
  }
}

