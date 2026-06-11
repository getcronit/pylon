import type {FieldSchema} from './standard-schema.js'

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

export type RelationKind = 'belongsTo' | 'hasMany' | 'manyToMany'

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
  /** manyToMany: explicit join-table name (default: the two tables, sorted). */
  through?: string
  /** manyToMany: join column referencing THIS model (default: `<table>_<pk>`). */
  sourceColumn?: string
  /** manyToMany: join column referencing the TARGET (default: `<table>_<pk>`). */
  targetColumn?: string
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
}

/** Columns are accumulated per-constructor before @model finalizes the model. */
const pendingColumns = new WeakMap<Function, Map<string, ColumnDefinition>>()
const pendingRelations = new WeakMap<
  Function,
  Map<string, RelationDefinition>
>()
const models = new Map<Function, ModelDefinition>()

/** App-level metadata declared via `models.app(name, {dependsOn})`. */
export interface AppMeta {
  dependsOn?: string[]
}
const appMeta = new Map<string, AppMeta>()

/** Record (or merge) an app's metadata — called by `models.app(name, opts)`. */
export function recordApp(name: string, meta: AppMeta = {}): void {
  const prev = appMeta.get(name) ?? {}
  appMeta.set(name, {dependsOn: [...(prev.dependsOn ?? []), ...(meta.dependsOn ?? [])]})
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
    /** Full-text search: synthesize hidden generated tsvector column(s) + GIN. */
    search?:
      | {columns: string[]; language?: string; name?: string}
      | Array<{columns: string[]; language?: string; name?: string}>
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
    tenantColumn: options.tenant ? merged.get(options.tenant)?.columnName : undefined
  }

  if (!options.abstract) {
    models.set(ctor, definition)
  }
  return definition
}

export function getModelDefinition(ctor: Function): ModelDefinition | undefined {
  return models.get(ctor)
}

export function getModelDefinitionOrThrow(ctor: Function): ModelDefinition {
  const def = models.get(ctor)
  if (!def) {
    throw new Error(
      `No model definition for "${
        (ctor as any).name
      }". Did you forget the @model() decorator?`
    )
  }
  return def
}

/** All concrete (non-abstract) registered models. */
export function allModels(): ModelDefinition[] {
  return Array.from(models.values())
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
