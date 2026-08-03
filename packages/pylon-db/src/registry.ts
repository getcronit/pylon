import type {FieldSchema} from './standard-schema.js'
import type {QueryConfig} from './query-schema.js'

export type SqlType =
  | 'text'
  | 'varchar'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'boolean'
  | 'timestamptz'
  | 'date'
  | 'jsonb'
  | 'uuid'
  | 'tsvector'

export interface ColumnDefinition {
  /** Name of the class property this column maps to. */
  propertyKey: string
  /** Database column name (snake_case of the property by default). */
  columnName: string
  sqlType: SqlType
  primaryKey: boolean
  /** Database-generated identity (serial / bigserial). */
  autoIncrement: boolean
  unique: boolean
  nullable: boolean
  /**
   * A `jsonb` column whose GraphQL type is the STRUCTURED generic (`models.Struct<T>`), not the
   * opaque `JSON` scalar. The runtime column is identical to `models.JSON`; this only tells the
   * schema layer to expose `T` (the parser's reflected object type) rather than collapse to `JSON`.
   */
  struct?: boolean
  /**
   * Hidden from the GraphQL layer ($-prefixed properties). The column is still
   * persisted — it is only omitted from the generated API. Reserved for the
   * Phase 3 GraphQL integration; carried here so the model is the single
   * source of truth.
   */
  hidden: boolean
  length?: number
  /** `numeric(precision, scale)` — decimal precision (total digits). */
  precision?: number
  /** `numeric(precision, scale)` — decimal scale (digits after the point). */
  scale?: number
  /** Client-side generator re-run on every UPDATE (e.g. updatedAt timestamp). Runtime-only. */
  onUpdateFn?: () => unknown
  /** Literal default value applied client-side on insert. */
  default?: unknown
  /**
   * Client-side default *generator*, resolved at insert when no value is set
   * (e.g. a cuid/uuid id). Runtime-only — never serialized to the IR/DDL.
   */
  defaultFn?: () => unknown
  /** Raw SQL default (e.g. `now()`, `gen_random_uuid()`). */
  defaultSql?: string
  /** Create a secondary (non-unique) btree index on this column. */
  index?: boolean
  /** A column CHECK expression (e.g. `price > 0` or an enum `IN (…)`). */
  check?: string
  /** Postgres array column (`<sqlType>[]`). */
  array?: boolean
  /** This FK column's type follows its target's primary key (resolved lazily,
   *  since the target is a forward reference at decoration time). */
  fkInferType?: boolean
  /** Stored generated-column expression (e.g. a `tsvector` from text columns). */
  generatedAs?: string
  /** Full-text search config/language for a `tsvector` column (e.g. `english`). */
  ftsLanguage?: string
  /** Dialect requirement (Postgres-only features like tsvector/GIN). */
  requires?: 'postgres'
  // ── Runtime validation rules (not part of the serializable IR/DDL) ──────────
  /** Numbers: minimum value. Strings: minimum length. */
  min?: number
  /** Numbers: maximum value. Strings: maximum length. */
  max?: number
  /** String must match this pattern. */
  pattern?: RegExp
  /** String must be a valid email. */
  email?: boolean
  /** Allowed values (enum membership). */
  enumValues?: readonly string[]
  /** Custom rule: return `true`, or an error message string. */
  validate?: (value: unknown) => true | string
  /**
   * Bring-your-own schema (Zod / Valibot / ArkType — anything implementing
   * Standard Schema). Runs after the built-in rules; its issues surface as
   * `custom` with the library's own message. Not part of the IR/DDL.
   */
  schema?: FieldSchema
}

export type RelationKind =
  | 'belongsTo'
  | 'hasOne'
  | 'hasMany'
  | 'manyToMany'
  | 'hasManyThrough'

export type OnDelete = 'cascade' | 'set null' | 'restrict' | 'no action'

export interface RelationDefinition {
  kind: RelationKind
  /** Property the lazy accessor is installed on (e.g. `author`, `posts`). */
  propertyKey: string
  /** Lazily-resolved target model constructor (forward references allowed). */
  target: () => Function
  nullable: boolean
  /** belongsTo: the local FK scalar property (e.g. `authorId`). */
  fkProperty?: string
  /** belongsTo: the local FK column name (e.g. `author_id`). */
  fkColumn?: string
  /** belongsTo: ON DELETE behavior for the generated FK constraint. */
  onDelete?: OnDelete
  /** hasMany: the FK *property* on the target model that points back here. */
  targetForeignKey?: string
  /** hasMany: default ordering for the plain list — a target property name,
   *  optionally `-`-prefixed for descending (e.g. `createdAt` / `-createdAt`). */
  orderBy?: string
  /** hasManyThrough: the INTERMEDIATE model (e.g. `() => TicketMessage`) — a thunk so
   *  TS can infer it and type `foreignKey`/`via` against its fields. */
  throughTarget?: () => Function
  /** hasManyThrough: the FK *property* on the intermediate that points back to THIS
   *  owner (e.g. `TicketMessage.ticketId`). */
  throughForeignKey?: string
  /** hasManyThrough: the `hasMany` | `manyToMany` relation on the INTERMEDIATE
   *  model that reaches the target (e.g. `TicketMessage.comments`). */
  viaRelation?: string
  /** hasManyThrough: a static scope predicate ANDed onto the target (e.g.
   *  `{deletedAt: null}`). Serialized only for the accessor — never hits the IR. */
  where?: unknown
  /** manyToMany: explicit join-table name (default: the two tables, sorted). */
  through?: string
  /** manyToMany: join column referencing THIS model (default: `<table>_<pk>`). */
  sourceColumn?: string
  /** manyToMany: join column referencing the TARGET (default: `<table>_<pk>`). */
  targetColumn?: string
  /** manyToMany: the inverse side — accessor only, does NOT synthesize the join
   *  table (the canonical side owns it). Required for cross-app m2m. */
  inverse?: boolean
  /** hasMany/manyToMany: expose as a cursor-paginated Relay `Connection` (a
   *  callable field with `first/after/last/before` args) instead of a plain list.
   *  The ORM IR skips it — the type-checker reads the callable field type and
   *  emits the `Connection` shape (+ args), so there's a single source for it. */
  paginate?: boolean
  /** Hide this relation from the generated GraphQL API (kept usable in code). The
   *  m2m join table is still synthesized for migrations. */
  hidden?: boolean
}

/** A model-level (possibly composite) secondary index. `columns` are PROPERTY keys. */
export interface ModelIndex {
  columns: string[]
  unique?: boolean
  /** Index method — `gin` for full-text (`tsvector`); default btree. */
  method?: 'gin' | 'btree'
  /** Override the generated index name. */
  name?: string
}

export interface ModelDefinition {
  ctor: Function
  tableName: string
  abstract: boolean
  columns: ColumnDefinition[]
  relations: RelationDefinition[]
  primaryKey?: ColumnDefinition
  /** Migration-group / app this model belongs to (set via `models.app(name)`). */
  app?: string
  /** Model-level composite indexes (single-column ones come from `{index:true}`). */
  indexes?: ModelIndex[]
  /** Column name to auto-scope by tenant (resolved from `models.app(name,{tenant})`). */
  tenantColumn?: string
  /** Deny-by-default: an action with no matching policy rule is rejected
   *  (`@model({secure: true})`). Without it, an action with no rule is allowed. */
  secure?: boolean
  /** Relay `Node` opt-in for THIS model: expose a `gid://…` id + implement `Node`.
   *  Set from the app's top-level `node` option (or the model's `static config.node`);
   *  `undefined` falls back to the project default. See `nodeEnabledFor`. */
  node?: boolean
  /** Column names that get a `gin_trgm_ops` index for substring (`contains`)
   *  search (`@model({trigram})`). */
  trigramColumns?: string[]
  /** Per-model query/filter configuration — virtual fields + public allowlist
   *  (`@model({query})`). Consumed by the Query Schema. */
  query?: QueryConfig
  /** Single-table inheritance: this model is an STI **base** — its subclasses
   *  share this table, discriminated by the named column. Projected as a GraphQL
   *  interface named after the class (see `toIR`). */
  inheritance?: {discriminator: string}
  /** Single-table inheritance: this model is an STI **subclass** — the value of
   *  the base's discriminator column that selects it. */
  discriminatorValue?: string | number
  /** Single-table inheritance: resolved subclass binding (base ctor + the
   *  discriminator property/column/value). Set at finalize; drives query scoping,
   *  create-time discriminator, and base→subclass materialisation. */
  sti?: {
    baseCtor: Function
    property: string
    column: string
    value: string | number
  }
}

/** Columns are accumulated per-constructor before @model finalizes the model. */
const pendingColumns = new WeakMap<Function, Map<string, ColumnDefinition>>()
const pendingRelations = new WeakMap<
  Function,
  Map<string, RelationDefinition>
>()
const models = new Map<Function, ModelDefinition>()

/** App-level metadata declared via `models.app(name, {dependsOn, migrations})`. */
export interface AppMeta {
  dependsOn?: string[]
  /** This app's migrations directory — colocated with the app's source. Absolute,
   *  or resolved by the CLI relative to the project root. */
  dir?: string
}
const appMeta = new Map<string, AppMeta>()

/** Record (or merge) an app's metadata — called by `models.app(name, opts)`. */
export function recordApp(name: string, meta: AppMeta = {}): void {
  const prev = appMeta.get(name) ?? {}
  appMeta.set(name, {
    dependsOn: [...(prev.dependsOn ?? []), ...(meta.dependsOn ?? [])],
    dir: meta.dir ?? prev.dir
  })
}

/** Declared metadata for an app, if any. */
export function getAppMeta(name: string): AppMeta | undefined {
  return appMeta.get(name)
}

export function registerColumn(
  ctor: Function,
  column: ColumnDefinition
): void {
  let cols = pendingColumns.get(ctor)
  if (!cols) {
    cols = new Map()
    pendingColumns.set(ctor, cols)
  }
  cols.set(column.propertyKey, column)
}

export function registerRelation(
  ctor: Function,
  relation: RelationDefinition
): void {
  let rels = pendingRelations.get(ctor)
  if (!rels) {
    rels = new Map()
    pendingRelations.set(ctor, rels)
  }
  rels.set(relation.propertyKey, relation)
}

function ownColumns(ctor: Function): ColumnDefinition[] {
  return Array.from(pendingColumns.get(ctor)?.values() ?? [])
}

function ownRelations(ctor: Function): RelationDefinition[] {
  return Array.from(pendingRelations.get(ctor)?.values() ?? [])
}

/**
 * Finalize a model: merge columns declared on parent classes (Django-style
 * abstract base models) with this class's own columns, resolve the primary key,
 * and store the definition.
 */
export function finalizeModel(
  ctor: Function,
  options: {
    tableName: string
    abstract: boolean
    app?: string
    indexes?: ModelIndex[]
    /** Property name of the tenant FK (auto-scope column); skipped if absent on this model. */
    tenant?: string
    /** Deny-by-default for policy actions with no matching rule. */
    secure?: boolean
    /** Relay `Node` opt-in for this model (else the project default applies). */
    node?: boolean
    /** Full-text search: synthesize hidden generated tsvector column(s) + GIN. */
    search?:
      | {columns: string[]; language?: string; name?: string}
      | Array<{columns: string[]; language?: string; name?: string}>
    /** Trigram substring search: `gin_trgm_ops` GIN index on each named column. */
    trigram?: {columns: string[]}
    /** Query/filter config — virtual fields + public allowlist (`@model({query})`). */
    query?: QueryConfig
    /** STI base: subclasses share this table, discriminated by the named column. */
    inheritance?: {discriminator: string}
    /** STI subclass: the discriminator value that selects it. */
    discriminatorValue?: string | number
    /** STI subclass: resolved binding (base ctor + discriminator property/column/value). */
    sti?: {baseCtor: Function; property: string; column: string; value: string | number}
  }
): ModelDefinition {
  const merged = new Map<string, ColumnDefinition>()
  const mergedRelations = new Map<string, RelationDefinition>()

  // Walk the prototype chain so inherited columns/relations are included.
  const chain: Function[] = []
  let current: Function | null = ctor
  while (current && current !== Function.prototype) {
    chain.unshift(current) // base-most first so subclasses override
    current = Object.getPrototypeOf(current)
  }
  for (const link of chain) {
    for (const col of ownColumns(link)) {
      merged.set(col.propertyKey, col)
    }
    for (const rel of ownRelations(link)) {
      mergedRelations.set(rel.propertyKey, rel)
    }
  }

  // Full-text search: synthesize a hidden, STORED-generated tsvector column per
  // search set (resolved now that the chain is merged). Multiple sets need
  // distinct names.
  const searchSets = options.search
    ? Array.isArray(options.search)
      ? options.search
      : [options.search]
    : []
  for (const set of searchSets) {
    const language = set.language ?? 'english'
    const name = set.name ?? 'fts'
    if (merged.has(name)) {
      throw new Error(
        `@model search on "${options.tableName}": duplicate column "${name}" — give each search set a unique \`name\`.`
      )
    }
    const expr = `to_tsvector('${language}', ${set.columns
      .map(prop => {
        const colName = merged.get(prop)?.columnName
        if (!colName) {
          throw new Error(
            `@model search: unknown property "${prop}" on "${options.tableName}".`
          )
        }
        return `coalesce("${colName}", '')`
      })
      .join(" || ' ' || ")})`
    merged.set(name, {
      propertyKey: name,
      columnName: name,
      sqlType: 'tsvector',
      primaryKey: false,
      autoIncrement: false,
      unique: false,
      nullable: true,
      hidden: true,
      generatedAs: expr,
      ftsLanguage: language,
      requires: 'postgres'
    })
  }

  // Trigram substring search: resolve the property names to column names now (so
  // the IR can emit a `gin_trgm_ops` index per column). Validate each exists.
  const trigramColumns = (options.trigram?.columns ?? []).map(prop => {
    const colName = merged.get(prop)?.columnName
    if (!colName) {
      throw new Error(
        `@model trigram: unknown property "${prop}" on "${options.tableName}".`
      )
    }
    return colName
  })

  const columns = Array.from(merged.values())
  const relations = Array.from(mergedRelations.values())
  const primaryKey = columns.find(c => c.primaryKey)

  const definition: ModelDefinition = {
    ctor,
    tableName: options.tableName,
    abstract: options.abstract,
    columns,
    relations,
    primaryKey,
    app: options.app,
    indexes: options.indexes,
    // Resolve the tenant property → column; skip silently if this model has no
    // such column (lets non-tenant lookup tables live in a tenant-scoped app).
    tenantColumn: options.tenant ? merged.get(options.tenant)?.columnName : undefined,
    secure: options.secure,
    node: options.node,
    trigramColumns: trigramColumns.length ? trigramColumns : undefined,
    query: options.query,
    inheritance: options.inheritance,
    discriminatorValue: options.discriminatorValue,
    sti: options.sti
  }

  if (!options.abstract) {
    models.set(ctor, definition)
  }
  return definition
}

/**
 * The concrete SQL type of a column. For a foreign-key column whose type was
 * left to follow its target (the common case — no explicit `{type}`), this is
 * the referenced model's primary-key type, resolved now that all models exist
 * (e.g. a cuid `text` PK → a `text` FK, not the `bigint` default). Falls back to
 * the column's stored type if the target/PK can't be resolved.
 */
export function resolveColumnSqlType(
  def: ModelDefinition,
  col: ColumnDefinition
): SqlType {
  if (!col.fkInferType) return col.sqlType
  const rel = def.relations.find(
    r => r.kind === 'belongsTo' && r.fkProperty === col.propertyKey
  )
  const target = rel && models.get(rel.target())
  return target?.primaryKey?.sqlType ?? col.sqlType
}

/**
 * Strip esbuild's self-reference inner-name underscore so a model resolves by a stable
 * name across bundles. A self-referential static (`static objects = manager(Foo)`)
 * compiles, under `useDefineForClassFields:false`, to `var Foo = class _Foo {…}`, so one
 * graph may see `_Foo` and another `Foo`. (An intentional `_Foo` mangles to `__Foo`, so
 * stripping exactly ONE leading underscore round-trips it.)
 */
export function normalizedCtorName(ctor: Function): string {
  const n = (ctor as {name?: string}).name ?? ''
  return /^_[A-Za-z]/.test(n) ? n.slice(1) : n
}

export function getModelDefinition(ctor: Function): ModelDefinition | undefined {
  const direct = models.get(ctor)
  if (direct) return direct

  // Cross-bundle fallback. The framework can split a project into several esbuild graphs
  // (e.g. the server bundle + the runtime-config bundle that hosts auth middleware), each
  // carrying its OWN copy of a model class. pylon-db is external, so the registry is shared
  // — but it's keyed by class IDENTITY, so a class copy from a graph that never constructed
  // its app misses. Resolve by (underscore-normalized) name: a model's name is unique
  // project-wide (it IS the GraphQL type name, which the SDL already requires to be unique),
  // so the match is unambiguous and carries the right binding (table prefix, tenant,
  // columns). Alias the duplicate copy → the same definition so later lookups are O(1).
  // This restores what the old class-def-time decorator gave for free: every graph that
  // imported the class registered its own copy.
  const name = normalizedCtorName(ctor)
  if (!name) return undefined
  for (const def of models.values()) {
    if (normalizedCtorName(def.ctor) === name) {
      models.set(ctor, def)
      return def
    }
  }
  return undefined
}

export function getModelDefinitionOrThrow(ctor: Function): ModelDefinition {
  const def = getModelDefinition(ctor)
  if (!def) {
    const name = normalizedCtorName(ctor) || (ctor as any).name
    throw new Error(
      `No model definition for "${name}". Register it on an app — ` +
        `\`new Pylon({db: {models: [${name || 'Model'}]}})\`.`
    )
  }
  return def
}

/** All concrete (non-abstract) registered models. */
export function allModels(): ModelDefinition[] {
  return Array.from(models.values())
}

// Project-wide DEFAULT for the Relay `Node` layer, set by the constructing app's
// top-level `node` option. Because the composition ROOT constructs last (its leaf
// apps are imported — hence constructed — first), the root's `node` wins as the
// default; a leaf app (or a model's own `static config.node`) overrides it per
// model. Read by `toIR()` to decide which entities expose `gid://…` ids +
// implement `Node`. `undefined` = "no app set it" (treated as off).
let nodeDefault: boolean | undefined = undefined
/** Set the project-wide `node` default (an app's top-level `node` option). */
export function setNodeDefault(value: boolean): void {
  nodeDefault = value
}
/** The project-wide `node` default (undefined if no app set one). */
export function nodeDefaultValue(): boolean | undefined {
  return nodeDefault
}
/** Whether a specific model exposes global ids: its own `node` (per-app / per-model
 *  `static config`) if set, else the project default. */
export function nodeEnabledFor(def: ModelDefinition): boolean {
  return def.node ?? nodeDefault ?? false
}
/** Whether any registered model has the `Node` layer on (the interface + `node()`
 *  field are added to the schema iff at least one entity opts in). */
export function anyNodeEnabled(): boolean {
  return allModels().some(nodeEnabledFor)
}

/**
 * Resolve a GraphQL type name back to its model definition. A model's
 * (underscore-normalized) class name IS its GraphQL type name and is unique
 * project-wide (the SDL requires it), so this is the reverse of that mapping —
 * the dispatch used by global-id (`gid://…/<TypeName>/…`) resolution.
 */
export function modelForTypeName(typeName: string): ModelDefinition | undefined {
  for (const def of models.values()) {
    if (normalizedCtorName(def.ctor) === typeName) return def
  }
  return undefined
}

/**
 * Register a pre-built definition for a ctor. Used to materialize *historical*
 * models inside migrations (reconstructed from migration state, not decorated).
 */
export function registerModelDefinition(
  ctor: Function,
  definition: ModelDefinition
): void {
  models.set(ctor, definition)
}
