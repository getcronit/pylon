/**
 * The Pylon IR — a normalized, serializable description of a Pylon application
 * that sits between source TypeScript and every generated artifact (GraphQL
 * schema, SQL/migrations, client SDK, queue contracts …).
 *
 * It is deliberately ORM-agnostic. A plain Pylon app — just resolvers returning
 * data shapes, no persistence — produces a complete IR using only `objects` and
 * `operations`. The ORM is one *optional* contributor that fills in `entities`
 * (tables, columns, relations). Nothing in this package imports or depends on
 * the ORM; the dependency direction is always ORM → IR, never the reverse.
 */

/** A normalized type reference — the single answer to "what shape is this?". */
export type TypeRef =
  | {kind: 'scalar'; name: ScalarName; nullable: boolean}
  | {kind: 'ref'; name: string; nullable: boolean} // → entity | object | enum
  | {kind: 'list'; of: TypeRef; nullable: boolean}

/** Known GraphQL scalars; `(string & {})` keeps the door open for custom ones. */
export type ScalarName =
  | 'ID'
  | 'String'
  | 'Int'
  | 'Float'
  | 'Number'
  | 'Boolean'
  | 'Date'
  | 'JSON'
  | (string & {})

/** Persistence vocabulary. Only fields with a `column` carry this. */
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

export type OnDelete = 'cascade' | 'set null' | 'restrict' | 'no action'

/** How a field is persisted (entities only). */
export interface ColumnSpec {
  name: string
  sqlType: SqlType
  primaryKey: boolean
  autoIncrement: boolean
  unique: boolean
  nullable: boolean
  length?: number
  default?: unknown
  defaultSql?: string
  /** Stored as a single JSON(B) column rather than a derived object type. */
  serialize?: 'json'
}

/** A secondary index on one or more columns. Self-contained (carries `table`)
 *  so it can be diffed and rendered without an entity lookup. */
export interface IndexSpec {
  /** Deterministic name: `<table>_<col…>_idx` (or `…_key` when unique). */
  name: string
  table: string
  /** Column names, in index order. */
  columns: string[]
  unique?: boolean
}

/** How a field relates to another entity (entities only). */
export interface RelationSpec {
  kind: 'belongsTo' | 'hasMany'
  /** Target entity name. */
  target: string
  /** belongsTo: the local FK scalar field (e.g. `authorId`). */
  fkField?: string
  /** hasMany: the FK field on the target pointing back (e.g. `authorId`). */
  targetFkField?: string
  onDelete?: OnDelete
}

/** A single member of an entity or object type. */
export interface Field {
  /** API-facing name (no `$`/`__` sigils — visibility lives in `exposed`). */
  name: string
  type: TypeRef
  /** Whether this field appears in the generated API. Intent, recorded once. */
  exposed: boolean
  /** Whitelisted GraphQL description. Never internal implementation docs. */
  description?: string
  /** Present iff the field is persisted. */
  column?: ColumnSpec
  /** Present iff the field is a relation. */
  relation?: RelationSpec
}

/** A persisted, table-backed object type. */
export interface Entity {
  name: string
  table: string
  abstract: boolean
  fields: Field[]
  /** Property name of the primary-key field, if any. */
  primaryKey?: string
  /** Interface names this type implements (e.g. `IModel`). */
  implements: string[]
  /** Secondary indexes (beyond PK / column-level UNIQUE constraints). */
  indexes?: IndexSpec[]
}

/** A non-persisted object type (DTO, json shape, resolver return shape). */
export interface ObjectType {
  name: string
  fields: Field[]
  /** Interface names this type implements. */
  implements?: string[]
  description?: string
}

/** A GraphQL interface (e.g. the `IModel` Pylon derives from a shared base). */
export interface InterfaceType {
  name: string
  fields: Field[]
  implements?: string[]
  description?: string
}

export interface EnumType {
  name: string
  values: string[]
  description?: string
}

/** A GraphQL union (`union Result = A | B`). */
export interface UnionType {
  name: string
  members: string[]
  description?: string
}

/** A GraphQL input object (resolver argument shapes). */
export interface InputType {
  name: string
  fields: Field[]
  description?: string
}

/** A root resolver. */
export interface Operation {
  root: 'Query' | 'Mutation' | 'Subscription'
  name: string
  args: Field[]
  returns: TypeRef
  description?: string
}

/** The whole normalized app. Serializable; no functions, no compiler handles. */
export interface PylonIR {
  version: 1
  entities: Record<string, Entity>
  objects: Record<string, ObjectType>
  interfaces: Record<string, InterfaceType>
  unions: Record<string, UnionType>
  inputs: Record<string, InputType>
  enums: Record<string, EnumType>
  /** Custom + built-in scalar names to emit. */
  scalars: string[]
  operations: Operation[]
}

/** An empty IR — the starting point a contributor pipeline builds on. */
export function emptyIR(): PylonIR {
  return {
    version: 1,
    entities: {},
    objects: {},
    interfaces: {},
    unions: {},
    inputs: {},
    enums: {},
    scalars: [],
    operations: []
  }
}
