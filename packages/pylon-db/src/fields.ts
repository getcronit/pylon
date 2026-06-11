import {createManager, ModelCtor} from './manager.js'
import {loadBelongsTo, ManyToManyManager, RelatedManager} from './relations.js'
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
    readonly options: FieldOptions & {length?: number; enumValues?: readonly string[]; array?: boolean}
  ) {}
}

/** Internal descriptor produced by a relation builder. */
class RelationBuilder {
  constructor(
    readonly kind: 'belongsTo' | 'hasMany' | 'manyToMany',
    readonly target: () => Function,
    readonly options: ForeignKeyOptions &
      HasManyOptions &
      ManyToManyOptions & {length?: number}
  ) {}
}

function field(
  sqlType: SqlType,
  base: Partial<ColumnDefinition>,
  options: FieldOptions & {length?: number; enumValues?: readonly string[]; array?: boolean}
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

export function numeric(options: NullableOpts): number | null
export function numeric(options?: FieldOptions): number
export function numeric(options: FieldOptions = {}): number | null {
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

export function json<T = unknown>(options: NullableOpts): T | null
export function json<T = unknown>(options?: FieldOptions): T
export function json<T = unknown>(options: FieldOptions = {}): T | null {
  return field('jsonb', {}, options) as T | null
}

/**
 * A constrained string column: stored as `text` with a `CHECK (… IN (…))`
 * constraint (not a native Postgres enum type — those are painful to migrate).
 * Typed as the union of the given values.
 */
export function enumColumn<const V extends string>(
  values: readonly V[],
  options: NullableOpts
): V | null
export function enumColumn<const V extends string>(
  values: readonly V[],
  options?: FieldOptions
): V
export function enumColumn<const V extends string>(
  values: readonly V[],
  options: FieldOptions = {}
): V | null {
  return field('text', {}, {...options, enumValues: values}) as V | null
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
export function foreignKey<R extends object>(
  target: () => ModelCtor<R>,
  options: ForeignKeyOptions & {nullable: true}
): number | null
export function foreignKey<R extends object>(
  target: () => ModelCtor<R>,
  options?: ForeignKeyOptions
): number
export function foreignKey<R extends object>(
  target: () => ModelCtor<R>,
  options: ForeignKeyOptions = {}
): number | null {
  return new RelationBuilder(
    'belongsTo',
    target as () => Function,
    options as ForeignKeyOptions & HasManyOptions
  ) as unknown as number | null
}

export interface HasManyOptions {
  /** The FK *property* on the target model that references this model. */
  foreignKey: string
}

/**
 * Reverse one-to-many. Assign to a property; it resolves to a `RelatedManager`
 * scoped to the parent's primary key.
 *
 * ```ts
 * posts = hasMany(() => Post, {foreignKey: 'authorId'})
 * ```
 */
export function hasMany<R extends object>(
  target: () => ModelCtor<R>,
  options: HasManyOptions
): RelatedManager<R> {
  return new RelationBuilder(
    'hasMany',
    target as () => Function,
    options as ForeignKeyOptions & HasManyOptions & ManyToManyOptions
  ) as unknown as RelatedManager<R>
}

export interface ManyToManyOptions {
  /**
   * Explicit join-table name. Defaults to both tables sorted and joined with
   * `_` (e.g. `post` + `tag` → `post_tag`), so both relation sides agree
   * without coordination.
   */
  through?: string
}

/**
 * Many-to-many. Declare it on *both* sides; a join table is synthesized (two
 * FK columns + a composite UNIQUE index) and shared by both. Resolves to a
 * {@link ManyToManyManager} scoped to the parent row.
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
  options: ManyToManyOptions = {}
): ManyToManyManager<R> {
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
   * Composite (multi-column) secondary indexes. `columns` are property names.
   * Single-column indexes use the field option `{index: true}`; a composite
   * unique constraint is `{columns: [...], unique: true}`.
   */
  indexes?: ModelIndex[]
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
    default: b.options.default,
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
            sqlType: value.options.type ?? 'bigint',
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
            through: value.options.through
          }
          registerRelation(Ctor, rel)
          relations.push(rel)
        } else {
          const rel: RelationDefinition = {
            kind: 'hasMany',
            propertyKey: key,
            target: value.target,
            nullable: true,
            targetForeignKey: value.options.foreignKey
          }
          registerRelation(Ctor, rel)
          relations.push(rel)
        }
      }
    }

    // 2. Wrapper subclass: every real construction runs the field initializers
    //    (producing descriptors) and we immediately replace them with the real
    //    runtime value (default or undefined). belongsTo descriptors sit on the
    //    FK scalar prop; hasMany descriptors never become own props (swallowed
    //    by the accessor's setter installed below).
    const Wrapped = class extends Ctor {
      constructor(...args: any[]) {
        super(...args)
        for (const k of Object.keys(this as object)) {
          const v = (this as any)[k]
          if (v instanceof FieldBuilder) {
            ;(this as any)[k] =
              'default' in v.options ? v.options.default : undefined
          } else if (v instanceof RelationBuilder) {
            ;(this as any)[k] = undefined
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
      } else if (rel.kind === 'manyToMany') {
        const {target, through} = rel
        Object.defineProperty(Wrapped.prototype, rel.propertyKey, {
          configurable: true,
          enumerable: false,
          get(this: any) {
            const def = getModelDefinitionOrThrow(this.constructor)
            const pkProperty = def.primaryKey?.propertyKey
            if (!pkProperty) {
              throw new Error(
                `Cannot resolve manyToMany "${rel.propertyKey}": "${def.tableName}" has no primary key.`
              )
            }
            return new ManyToManyManager(
              this.constructor as ModelCtor<any>,
              target() as ModelCtor<any>,
              this[pkProperty],
              through
            )
          },
          set() {
            /* no-op: relation is a computed accessor, not stored state */
          }
        })
      } else {
        const {target, targetForeignKey} = rel
        Object.defineProperty(Wrapped.prototype, rel.propertyKey, {
          configurable: true,
          enumerable: false,
          get(this: any) {
            const def = getModelDefinitionOrThrow(this.constructor)
            const pkProperty = def.primaryKey?.propertyKey
            if (!pkProperty) {
              throw new Error(
                `Cannot resolve hasMany "${rel.propertyKey}": "${def.tableName}" has no primary key.`
              )
            }
            return new RelatedManager(
              target() as ModelCtor<any>,
              targetForeignKey!,
              this[pkProperty]
            )
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
      tenant: options.tenant
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
