// ── Flat exports ────────────────────────────────────────────────────────────
// Low-level surface, used internally and by the build bridge. The recommended
// public API is the `models` / `db` / `migrations` namespaces below.
export {Model} from './model.js'
export {
  model,
  id,
  uuid,
  text,
  varchar,
  int,
  bigint,
  numeric,
  boolean,
  timestamp,
  date,
  json,
  foreignKey,
  hasMany,
  type ModelOptions,
  type FieldOptions,
  type ForeignKeyOptions,
  type HasManyOptions
} from './fields.js'
export {RelatedManager, type Relation} from './relations.js'
export {
  Database,
  connect,
  getDatabase,
  setDefaultDatabase,
  type DatabaseOptions
} from './database.js'
export {Manager, QuerySet, createManager, type ModelCtor} from './manager.js'
export {syncSchema, dropTables} from './schema-sync.js'
export {
  allModels,
  getModelDefinition,
  getModelDefinitionOrThrow,
  type ColumnDefinition,
  type ModelDefinition,
  type RelationDefinition,
  type RelationKind,
  type OnDelete,
  type SqlType
} from './registry.js'
export {toIR, entityFromDefinition} from './ir.js'
export {
  snapshot,
  serializeSnapshot,
  loadSnapshot,
  saveSnapshot,
  planMigration,
  applyMigration,
  type Snapshot
} from './migrations.js'
export {
  MigrationRunner,
  type MigrationFile,
  type MigrationRunnerOptions
} from './migration-runner.js'

import {createManager} from './manager.js'
import type {Manager as ManagerType, ModelCtor} from './manager.js'

/** Build a custom manager: `static objects = db.manager(User)`. */
export function manager<T extends object>(ctor: ModelCtor<T>): ManagerType<T> {
  return createManager(ctor)
}

// ── Namespaced public API (recommended) ──────────────────────────────────────
import {Model as ModelClass} from './model.js'
import * as fields from './fields.js'
import {RelatedManager as RelatedManagerClass} from './relations.js'
import * as database from './database.js'
import * as managerApi from './manager.js'
import * as schemaSync from './schema-sync.js'
import * as migrationApi from './migrations.js'
import {MigrationRunner as MigrationRunnerClass} from './migration-runner.js'

/**
 * Model-definition API. Field types are capitalized (Django-style):
 *
 * ```ts
 * class User extends models.Model {
 *   id    = models.ID()
 *   email = models.Text({unique: true})
 *   posts = models.HasMany(() => Post, {foreignKey: 'authorId'})
 * }
 * ```
 */
export const models = {
  Model: ModelClass,
  model: fields.model,
  ID: fields.id,
  UUID: fields.uuid,
  Text: fields.text,
  Varchar: fields.varchar,
  Int: fields.int,
  BigInt: fields.bigint,
  Numeric: fields.numeric,
  Boolean: fields.boolean,
  Timestamp: fields.timestamp,
  Date: fields.date,
  JSON: fields.json,
  ForeignKey: fields.foreignKey,
  HasMany: fields.hasMany,
  RelatedManager: RelatedManagerClass
} as const

/** Connection + query API. */
export const db = {
  Database: database.Database,
  connect: database.connect,
  getDatabase: database.getDatabase,
  setDefaultDatabase: database.setDefaultDatabase,
  Manager: managerApi.Manager,
  QuerySet: managerApi.QuerySet,
  manager,
  syncSchema: schemaSync.syncSchema,
  dropTables: schemaSync.dropTables
} as const

/** Migration authoring + workflow. */
export const migrations = {
  snapshot: migrationApi.snapshot,
  serializeSnapshot: migrationApi.serializeSnapshot,
  loadSnapshot: migrationApi.loadSnapshot,
  saveSnapshot: migrationApi.saveSnapshot,
  planMigration: migrationApi.planMigration,
  applyMigration: migrationApi.applyMigration,
  MigrationRunner: MigrationRunnerClass
} as const
