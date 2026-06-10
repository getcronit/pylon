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
  /** Literal default value applied client-side on insert. */
  default?: unknown
  /** Raw SQL default (e.g. `now()`, `gen_random_uuid()`). */
  defaultSql?: string
  /** Create a secondary (non-unique) btree index on this column. */
  index?: boolean
  /** A column CHECK expression (e.g. `price > 0` or an enum `IN (…)`). */
  check?: string
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
}

export type RelationKind = 'belongsTo' | 'hasMany'

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
}

export interface ModelDefinition {
  ctor: Function
  tableName: string
  abstract: boolean
  columns: ColumnDefinition[]
  relations: RelationDefinition[]
  primaryKey?: ColumnDefinition
}

/** Columns are accumulated per-constructor before @model finalizes the model. */
const pendingColumns = new WeakMap<Function, Map<string, ColumnDefinition>>()
const pendingRelations = new WeakMap<
  Function,
  Map<string, RelationDefinition>
>()
const models = new Map<Function, ModelDefinition>()

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
  options: {tableName: string; abstract: boolean}
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

  const columns = Array.from(merged.values())
  const relations = Array.from(mergedRelations.values())
  const primaryKey = columns.find(c => c.primaryKey)

  const definition: ModelDefinition = {
    ctor,
    tableName: options.tableName,
    abstract: options.abstract,
    columns,
    relations,
    primaryKey
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
