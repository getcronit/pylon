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
  | 'tsvector'

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
  /** `numeric(precision, scale)` — decimal precision (total digits). */
  precision?: number
  /** `numeric(precision, scale)` — decimal scale (digits after the point). */
  scale?: number
  default?: unknown
  defaultSql?: string
  /** A column CHECK expression, e.g. `price > 0` or `"status" IN ('a','b')`. */
  check?: string
  /** Stored as a single JSON(B) column rather than a derived object type. */
  serialize?: 'json'
  /** Postgres array column (`<sqlType>[]`), e.g. `text[]`. */
  array?: boolean
  /** A stored generated column: `GENERATED ALWAYS AS (<expr>) STORED`. */
  generatedAs?: string
  /** This text column is an enum (CHECK-constrained); its GraphQL type is the
   *  enum the type-checker names. Signals `mergeFields` to keep the parser's
   *  enum type rather than the ORM's `String`. */
  enum?: boolean
  /** Requires a specific dialect (e.g. `tsvector`/GIN need Postgres). A future
   *  non-Postgres adapter reads this to reimplement or reject the feature. */
  requires?: 'postgres'
}

/** A persisted column paired with its model property name (for migrations). */
export interface TableColumn extends ColumnSpec {
  /** Model property this column maps to (e.g. `categoryId` → `category_id`). */
  property: string
}

/**
 * The persistence-only view of an entity — what a migration needs to create or
 * reconstruct a table, with none of the GraphQL projection (no `type`/`exposed`,
 * no relation fields). `createTable`/`dropTable` carry this, not a full `Entity`,
 * so migration files stay lean and decoupled from the API shape.
 */
export interface TableSpec {
  /** Entity name — the key historical-model lookup uses. */
  name: string
  table: string
  columns: TableColumn[]
}

/** Project an entity to its persistence-only table spec (columns + table). */
export function tableSpecOf(entity: Entity): TableSpec {
  return {
    name: entity.name,
    table: entity.table,
    columns: entity.fields
      .filter(f => f.column)
      .map(f => ({property: f.name, ...f.column!}))
  }
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
  /** Index method — `gin` for full-text (`tsvector`) / trigram; default btree. */
  method?: 'gin' | 'btree'
  /** Per-column operator class, e.g. `gin_trgm_ops` for a `pg_trgm` substring
   *  index. Applied to every column of the index. When it's `gin_trgm_ops`, the
   *  DDL also ensures the `pg_trgm` extension exists. */
  ops?: string
}

/** A resolved foreign-key constraint — self-contained, no schema lookup needed. */
export interface ForeignKeyChange {
  /** Table the constraint lives on. */
  table: string
  /** Deterministic constraint name (`<table>_<column>_fkey`, Postgres style). */
  name: string
  /** Local FK column. */
  column: string
  /** Referenced table. */
  refTable: string
  /** Referenced column (the target's primary key). */
  refColumn: string
  onDelete?: OnDelete
}

/**
 * The full physical shape of one table: persistence columns + constraints +
 * indexes. Extends the lean `TableSpec` (what `createTable` carries) with the
 * pieces that arrive as separate ops. This is the unit of the canonical
 * migration state (`PhysicalSchema`).
 */
export interface PhysicalTable extends TableSpec {
  foreignKeys?: ForeignKeyChange[]
  indexes?: IndexSpec[]
}

/**
 * The canonical migration **state currency** — the whole physical schema, keyed
 * by entity name. Produced three ways (project models / fold op history /
 * introspect a live DB) and diffed pairwise. Nothing GraphQL here.
 */
export type PhysicalSchema = Record<string, PhysicalTable>

/** How a field relates to another entity (entities only). */
export interface RelationSpec {
  kind: 'belongsTo' | 'hasOne' | 'hasMany' | 'manyToMany'
  /** Target entity name. */
  target: string
  /** belongsTo: the local FK scalar field (e.g. `authorId`). */
  fkField?: string
  /** hasMany/hasOne: the FK field on the target pointing back (e.g. `authorId`). */
  targetFkField?: string
  /** manyToMany: explicit join-table name (default: the two tables, sorted). */
  through?: string
  /** manyToMany: join column referencing THIS entity (default: `<table>_<pk>`). */
  sourceColumn?: string
  /** manyToMany: join column referencing the TARGET (default: `<table>_<pk>`). */
  targetColumn?: string
  /** manyToMany: inverse side — accessor only, doesn't synthesize the join table. */
  inverse?: boolean
  onDelete?: OnDelete
}

/** Postgres truncates identifiers to 63 chars (NAMEDATALEN-1). */
const MAX_IDENT = 63

/** djb2 hash → base36. Deterministic + dependency-free (no node:crypto). */
function identHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/**
 * Clamp a generated identifier to Postgres's 63-char limit. Short names pass
 * through unchanged; an over-long name is truncated and suffixed with a hash of
 * the FULL name, so two distinct long names can't collide after truncation
 * (Postgres would otherwise silently truncate both to the same 63 chars — e.g.
 * the two FK constraints on a long-named m2m join table). Deterministic, so every
 * code path that builds the same name agrees.
 */
export function pgIdent(name: string): string {
  if (name.length <= MAX_IDENT) return name
  const suffix = `_${identHash(name)}`
  return name.slice(0, MAX_IDENT - suffix.length) + suffix
}

/** Join-table name for a many-to-many (deterministic so both sides agree). */
export function joinTableName(aTable: string, bTable: string, through?: string): string {
  return pgIdent(through ?? [aTable, bTable].sort().join('_'))
}

/** Join-table FK column referencing `table`'s primary key (e.g. post.id → post_id). */
export function joinColumn(table: string, pkColumn: string): string {
  return pgIdent(`${table}_${pkColumn}`)
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
  /** GraphQL arguments, when the field is callable (a method / a paginated
   *  relation: `posts(first, after, …): PostConnection`). Empty/absent for a
   *  plain field. Same shape as `Operation.args`. */
  args?: Field[]
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
