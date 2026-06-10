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
  enumColumn,
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
export {useDatabase, type UseDatabaseOptions, type DatabasePlugin} from './plugin.js'
export {
  ValidationError,
  validateInstance,
  type ValidationIssue,
  type ValidationCode
} from './validation.js'
export {
  validateWithSchema,
  type StandardSchemaV1,
  type FieldSchema
} from './standard-schema.js'
export {
  introspect,
  expectedColumns,
  computeDrift,
  hasDrift,
  schemaDrift,
  type SchemaDrift
} from './introspect.js'
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
  type GeneratedMigration,
  type MigrationLoader,
  type MigrationRunnerOptions
} from './migration-runner.js'
export {
  defineMigration,
  schema,
  createTable,
  dropTable,
  addColumn,
  dropColumn,
  alterColumn,
  addForeignKey,
  dropForeignKey,
  addIndex,
  dropIndex,
  renameColumn,
  runSql,
  run,
  isReversible,
  migrationChecksum,
  type Operation,
  type MigrationModule,
  type MigrationContext,
  type RunContext
} from './migration-ops.js'
export {
  buildHistoricalModels,
  type HistoricalModel,
  type HistoricalModels
} from './historical-models.js'
export {
  appGroups,
  orderGroups,
  groupRunner,
  groupModelDefinitions,
  generateGroup,
  migrateGroups,
  deployGroups,
  statusGroups,
  type MigrationGroup,
  type GroupApplyResult,
  type GroupStatus
} from './migration-groups.js'

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
import * as migrationOps from './migration-ops.js'
import * as groupsApi from './migration-groups.js'
import {recordApp} from './registry.js'

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
const modelBuilders = {
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
  Enum: fields.enumColumn,
  ForeignKey: fields.foreignKey,
  HasMany: fields.hasMany,
  RelatedManager: RelatedManagerClass
}

export const models = {
  ...modelBuilders,
  /**
   * Scope models to an app (a named migration group). Every class decorated with
   * the returned `model()` is tagged `app=name` in the registry, so `pylon db`
   * groups migrations by it and infers cross-app order from FKs. Use one per app
   * folder's index:
   *
   * ```ts
   * const blog = models.app('blog')
   * @blog.model() class Author extends blog.Model { id = blog.ID() }
   * ```
   *
   * `dependsOn` adds explicit app deps on top of the FK-inferred ones.
   */
  app(name: string, options: {dependsOn?: string[]} = {}) {
    recordApp(name, options)
    return {
      ...modelBuilders,
      model: (opts: fields.ModelOptions = {}) => fields.model({...opts, app: name})
    }
  }
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
  // authoring (migration files)
  defineMigration: migrationOps.defineMigration,
  schema: migrationOps.schema,
  // named schema operations (Django-style; built-in reverse)
  createTable: migrationOps.createTable,
  dropTable: migrationOps.dropTable,
  addColumn: migrationOps.addColumn,
  dropColumn: migrationOps.dropColumn,
  alterColumn: migrationOps.alterColumn,
  addForeignKey: migrationOps.addForeignKey,
  dropForeignKey: migrationOps.dropForeignKey,
  addIndex: migrationOps.addIndex,
  dropIndex: migrationOps.dropIndex,
  renameColumn: migrationOps.renameColumn,
  runSql: migrationOps.runSql,
  run: migrationOps.run,
  isReversible: migrationOps.isReversible,
  // workflow
  snapshot: migrationApi.snapshot,
  serializeSnapshot: migrationApi.serializeSnapshot,
  loadSnapshot: migrationApi.loadSnapshot,
  saveSnapshot: migrationApi.saveSnapshot,
  planMigration: migrationApi.planMigration,
  applyMigration: migrationApi.applyMigration,
  MigrationRunner: MigrationRunnerClass
} as const

/**
 * Migration groups — the data-layer primitive behind framework "apps":
 * per-group models + migrations, dependency-ordered, ledger-namespaced.
 */
export const groups = {
  fromRegistry: groupsApi.appGroups,
  order: groupsApi.orderGroups,
  runner: groupsApi.groupRunner,
  modelDefinitions: groupsApi.groupModelDefinitions,
  generate: groupsApi.generateGroup,
  migrate: groupsApi.migrateGroups,
  deploy: groupsApi.deployGroups,
  status: groupsApi.statusGroups
} as const
