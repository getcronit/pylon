import {type Connection, createManager, ModelCtor} from './manager.js'
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
 * Per-instance backing store for column values, behind the accessors installed
 * by `@model`. Held under a non-enumerable Symbol so it never leaks into a
 * spread / `JSON.stringify` of the instance.
 */
const COLUMN_STORE = Symbol('pylon.columns')

/**
 * An OWN, enumerable accessor descriptor for a column property. The getter/setter
 * are shared across instances (cached by column name — no per-instance closures).
 * The setter IGNORES `undefined` so `inst.col = undefined` is a true no-op (keeps
 * the current value), matching Prisma's "field not provided" semantics. `null` is
 * a real value and IS stored. Enumerable + own ⇒ spread / `Object.keys` /
 * `JSON.stringify` still see the value (it's read through the getter).
 */
const columnAccessors = new Map<string, PropertyDescriptor>()
function columnAccessor(key: string): PropertyDescriptor {
  let descriptor = columnAccessors.get(key)
  if (!descriptor) {
    descriptor = {
      enumerable: true,
      configurable: true,
      get(this: any) {
        return this[COLUMN_STORE]?.[key]
      },
      set(this: any, value: unknown) {
        if (value === undefined) return // no-op: "not provided" keeps the current value
        this[COLUMN_STORE][key] = value
      }
    }
    columnAccessors.set(key, descriptor)
  }
  return descriptor
}

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
 * The value is generated client-side (`new Date()`), so no SQL default leaks
 * into the model. For a DB-authoritative timestamp use the escape hatch
 * `timestamp({defaultSql: 'now()'})`.
 */
export function createdAt(options: FieldOptions = {}): Date {
  return field('timestamptz', {}, {...options, default: () => new Date()}) as Date
}

/**
 * A timestamp set on insert AND re-stamped on every update — Prisma's
 * `@updatedAt`. Same client-side generator: `default` fills it on insert,
 * `onUpdate` re-runs it on every write.
 */
export function updatedAt(options: FieldOptions = {}): Date {
  return field('timestamptz', {}, {
    ...options,
    default: () => new Date(),
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

export function model(options: ModelOptions = {}): ClassDecorator {
  return ((Ctor: any) => {
    // An explicit `table` wins verbatim. Otherwise the name is snake_case of the
    // class, namespaced by the app when one is set (`models.app('blog')` →
    // `blog_author`) so each app owns its own table prefix by default.
    const base = snakeCase(Ctor.name)
    const tableName =
      options.table ?? (options.app ? `${snakeCase(options.app)}_${base}` : base)
    const isAbstract = options.abstract ?? false

    // 1. Harvest this class's OWN fields by probing a raw instance. Inherited
    //    fields were already cleaned to real values by parent wrappers, so only
    //    own builders surface as descriptors here.
    const probe = new Ctor()
    const relations: RelationDefinition[] = []

    for (const [key, value] of Object.entries(probe)) {
      if (value instanceof FieldBuilder) {
        registerColumn(Ctor, buildColumn(key, value))
      } else if (value instanceof RelationBuilder) {
        if (value.kind === 'belongsTo') {
          const fkProperty = key
          const fkColumn = value.options.column ?? snakeCase(fkProperty)
          // The FK is a normal scalar column (filterable, hydrated like any other).
          registerColumn(Ctor, {
            propertyKey: fkProperty,
            columnName: fkColumn,
            // Without an explicit `{type}`, the FK type follows the target's PK
            // (resolved lazily — see resolveColumnSqlType). `bigint` is only a
            // fallback for when the target/PK can't be resolved.
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
            (fkProperty.endsWith('Id')
              ? fkProperty.slice(0, -2)
              : `${fkProperty}Ref`)
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
          relations.push(rel)
        } else if (value.kind === 'manyToMany') {
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
          relations.push(rel)
        } else if (value.kind === 'hasOne') {
          const rel: RelationDefinition = {
            kind: 'hasOne',
            propertyKey: key,
            target: value.target,
            nullable: true,
            targetForeignKey: value.options.foreignKey
          }
          registerRelation(Ctor, rel)
          relations.push(rel)
        } else {
          const rel: RelationDefinition = {
            kind: 'hasMany',
            propertyKey: key,
            target: value.target,
            nullable: true,
            targetForeignKey: value.options.foreignKey,
            paginate: value.options.paginate
          }
          registerRelation(Ctor, rel)
          relations.push(rel)
        }
      }
    }

    // 2. Wrapper subclass: every real construction runs the field initializers
    //    (producing builder descriptors) and we immediately replace them. Column
    //    props (scalar fields + belongsTo FK scalars) become OWN, enumerable
    //    accessors backed by a per-instance store, whose setter ignores
    //    `undefined` (so `inst.x = undefined` is a no-op, never corrupting a
    //    value). hasMany/m2m descriptors are dropped so the prototype getter
    //    (installed below) shows through.
    const Wrapped = class extends Ctor {
      constructor(...args: any[]) {
        super(...args)
        // Per-instance backing store (non-enumerable). Guarded so a subclass
        // wrapper doesn't reset the store a parent wrapper already populated.
        if (!Object.prototype.hasOwnProperty.call(this, COLUMN_STORE)) {
          Object.defineProperty(this, COLUMN_STORE, {
            value: {} as Record<string, unknown>,
            enumerable: false,
            writable: true,
            configurable: true
          })
        }
        const store = (this as any)[COLUMN_STORE] as Record<string, unknown>
        for (const k of Object.keys(this as object)) {
          const v = (this as any)[k]
          const isColumn =
            v instanceof FieldBuilder ||
            (v instanceof RelationBuilder && v.kind === 'belongsTo') // FK scalar column
          if (isColumn) {
            delete (this as any)[k]
            Object.defineProperty(this, k, columnAccessor(k))
            if (v instanceof FieldBuilder) {
              // A literal default is applied at construction; a function default
              // (cuid/uuid) is resolved at insert time in saveInstance.
              const d = v.options.default
              if ('default' in v.options && typeof d !== 'function') store[k] = d
            }
          } else if (v instanceof RelationBuilder) {
            delete (this as any)[k] // hasMany / manyToMany → prototype accessor
          }
        }
      }
    }
    // The anonymous class expression is named "Wrapped"; restore the original
    // so table names, relation targets and GraphQL type names stay correct.
    Object.defineProperty(Wrapped, 'name', {value: Ctor.name})

    // 3. Install relation accessors on the wrapper prototype.
    for (const rel of relations) {
      if (rel.kind === 'belongsTo') {
        const {fkProperty, target} = rel
        Object.defineProperty(Wrapped.prototype, rel.propertyKey, {
          configurable: true,
          enumerable: false,
          get(this: any) {
            const fk = this[fkProperty!]
            if (fk === null || fk === undefined) return Promise.resolve(null)
            return loadBelongsTo(target() as ModelCtor<any>, fk)
          }
        })
      } else if (rel.kind === 'hasOne') {
        // Inverse 1:1 — resolve the single child whose FK points at this row's PK
        // (batched like hasMany, takes the first). Returns Promise<T | null>.
        const {target, targetForeignKey} = rel
        Object.defineProperty(Wrapped.prototype, rel.propertyKey, {
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
        Object.defineProperty(Wrapped.prototype, rel.propertyKey, {
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
        Object.defineProperty(Wrapped.prototype, rel.propertyKey, {
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

    // 4. Finalize: merge columns/relations inherited via the prototype chain.
    finalizeModel(Wrapped, {
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

    // 5. Default manager (a custom `static objects = manager(...)` wins).
    if (
      !isAbstract &&
      !Object.prototype.hasOwnProperty.call(Wrapped, 'objects')
    ) {
      Object.defineProperty(Wrapped, 'objects', {
        value: createManager(Wrapped as any),
        writable: false,
        enumerable: false,
        configurable: true
      })
    }

    return Wrapped
  }) as ClassDecorator
}
