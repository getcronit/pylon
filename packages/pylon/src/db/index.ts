// Side-effect: register the `app.model()` / `app.models()` augmentation with core's
// extension bus. No-op until core (`@getcronit/pylon`) loads — so importing pylon-db
// for the CLI/migrations never pulls in core's web runtime. See `app.ts`.
import './app.js'
export type {AppModelOptions} from './app.js'
// The model classes an app owns (registered via `new Pylon({db: {models}})`), walking
// composed children — the IR-harvest seam the build/inspect tooling reads.
export {modelsOf} from './app.js'

// ── Flat exports ────────────────────────────────────────────────────────────
// Low-level surface, used internally and by the build bridge. The recommended
// public API is the `models` / `db` / `migrations` namespaces below.
export {Model} from './model.js'
export {
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
  createdAt,
  updatedAt,
  json,
  vector,
  enumOf,
  array,
  foreignKey,
  hasOne,
  hasMany,
  hasManyThrough,
  manyToMany,
  type ModelOptions,
  type ModelConfig,
  type SearchOptions,
  type FieldOptions,
  type NumericOptions,
  type ForeignKeyOptions,
  type HasOneOptions,
  type HasManyOptions,
  type HasManyThroughOptions,
  type ManyToManyOptions
} from './fields.js'
export {createId, uuidv4} from './id.js'
export {
  snowflake,
  decodeSnowflake,
  snowflakeDefault,
  setSnowflakeNodeId,
  snowflakeNodeId,
  isSnowflakeString,
  DEFAULT_SNOWFLAKE_EPOCH,
  type SnowflakeOptions,
  type DecodedSnowflake
} from './snowflake.js'
export {
  toGid,
  fromGid,
  isGid,
  decodeId,
  setGidNamespace,
  GID_NAMESPACE,
  type ParsedGid
} from './gid.js'
export {resolveNode} from './node-resolve.js'
export {leaseNodeId, type NodeLease, type NodeLeaseOptions} from './node-lease.js'
export {
  RelatedManager,
  ManyToManyManager,
  HasManyThroughManager,
  type Relation,
  type Linkable
} from './relations.js'
export {
  keyedQuery,
  batchKey,
  type KeyProjection,
  type KeyedQueryOptions,
  type KeyedTerminal,
  type OrderSpec
} from './keyed-query.js'
export {
  Database,
  connect,
  getDatabase,
  setDefaultDatabase,
  inTransaction,
  transaction,
  onCommit,
  databaseForKysely,
  type DatabaseOptions
} from './database.js'
export {
  Manager,
  QuerySet,
  createManager,
  createMany,
  upsertMany,
  deleteManyInstances,
  type BulkOptions,
  type UpsertOptions,
  type ModelCtor,
  type Connection,
  type Edge,
  type PageInfo,
  type PaginateArgs,
  type WhereInput,
  type Match,
  type NearestMetric,
  type NearestQuerySet
} from './manager.js'
export {syncSchema, dropTables} from './schema-sync.js'
// `useDatabase` is the CONFIG PLUGIN → exported from `@getcronit/pylon/db/plugin`
// (see ./plugin.ts), not from the authoring-API root. This keeps the uniform
// convention: `./db` = authoring API, `./db/plugin` = the plugin.
export {gate, type GateOptions} from './gate.js'
// Resource-tier authz (row/instance/field), enforced inside the ORM. Capability
// authz (authorize-predicate/requireRole/hasRole) lives in pylon-auth.
// `defineAbilities` is INTERNAL — author rules via a model's `static abilities`
// (own rules) or the app's `db: {abilities}` (cross-entity); both wire it under the hood.
export {
  authorize,
  can,
  cannot,
  filter,
  type AbilitiesFn,
  type AbilityRule,
  type AbilityRuleResult,
  type ModelAbilitiesFn,
  type ModelAbilityRule
} from './abilities.js'
export {matchWhere, AbilityMatchError} from './matcher.js'
export {
  runWithAppContext,
  getAppContext,
  currentTenant,
  currentFeatures,
  currentFeatureState,
  currentPrincipal,
  type AppContext,
  type FeatureState,
  type FeatureValue
} from './app-context.js'
export {
  defineFeatures,
  requireFeature,
  isFeatureEnabled,
  featureValue,
  featuresResolver,
  gateResolvers,
  ForbiddenError,
  FeatureDisabledError,
  type FeatureProvider
} from './features.js'
export {runAsSystem} from './app-context.js'
// Per-model row policies are the LOW-LEVEL seam (`db.definePolicy`), what the
// high-level `abilities` surface in @getcronit/pylon/app compiles into. App-wide
// defaults (`models.app({policy})`) and the policy context type stay public.
export {type PolicyContext, type AppPolicy} from './policies.js'
export {
  signals,
  type ConnectOptions,
  type SaveSignalPayload,
  type DeleteSignalPayload
} from './signals.js'
export {
  ValidationError,
  uniqueViolation,
  validateInstance,
  type ValidationIssue,
  type ValidationCode
} from './validation.js'
export {NotFoundError, BadRequestError} from './errors.js'
export {
  validateWithSchema,
  type StandardSchemaV1,
  type FieldSchema
} from './standard-schema.js'
export {generateModelSource} from './codegen.js'
export {
  introspect,
  introspectPhysical,
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
export {parseSearchQuery, QueryParseError} from './query-parser.js'
export {
  buildQuerySchema,
  publicFieldNames,
  MAX_RELATION_DEPTH,
  type QuerySchema,
  type QueryableField,
  type RelationField,
  type QueryOp,
  type FieldVisibility,
  type QueryScope,
  type SearchTarget,
  type QueryConfig,
  type QueryFieldConfig,
  type QueryFieldToWhere
} from './query-schema.js'
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
  renameTable,
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
  renameGroupApp,
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
import * as policyApi from './policies.js'
import {createId as createIdFn, uuidv4 as uuidv4Fn} from './id.js'
import {snowflake as snowflakeFn} from './snowflake.js'
import {
  ManyToManyManager as ManyToManyManagerClass,
  RelatedManager as RelatedManagerClass
} from './relations.js'
import * as database from './database.js'
import * as managerApi from './manager.js'
import * as schemaSync from './schema-sync.js'
import * as migrationApi from './migrations.js'
import {MigrationRunner as MigrationRunnerClass} from './migration-runner.js'
import * as migrationOps from './migration-ops.js'
import * as groupsApi from './migration-groups.js'
import {recordApp} from './registry.js'
import {gateResolvers} from './features.js'

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
  CreatedAt: fields.createdAt,
  UpdatedAt: fields.updatedAt,
  JSON: fields.json,
  Struct: fields.struct,
  Vector: fields.vector,
  Enum: fields.enumOf,
  Array: fields.array,
  ForeignKey: fields.foreignKey,
  HasOne: fields.hasOne,
  HasMany: fields.hasMany,
  HasManyThrough: fields.hasManyThrough,
  ManyToMany: fields.manyToMany,
  RelatedManager: RelatedManagerClass,
  ManyToManyManager: ManyToManyManagerClass,
  /** Client-side id generators for text PKs (`default: createId`/`uuidv4`/`snowflake()`). */
  createId: createIdFn,
  uuidv4: uuidv4Fn,
  snowflake: snowflakeFn
}

/**
 * The model-authoring namespace: the `Model` base + capitalized field/relation
 * builders. Author a plain `class Post extends models.Model {…}` and register it on an
 * app — `new Pylon({name, db: {models: [Post]}})` — which names + groups it. There is no
 * decorator and no `models.app()` factory.
 */
export const models = {
  ...modelBuilders
} as const

/** Connection + query API. */
export const db = {
  Database: database.Database,
  connect: database.connect,
  getDatabase: database.getDatabase,
  setDefaultDatabase: database.setDefaultDatabase,
  transaction: database.transaction,
  onCommit: database.onCommit,
  Manager: managerApi.Manager,
  QuerySet: managerApi.QuerySet,
  manager,
  syncSchema: schemaSync.syncSchema,
  dropTables: schemaSync.dropTables,
  /** Low-level per-model row policy seam. Prefer `abilities` (pylon-app); this is
   *  the escape hatch it compiles into, for raw-ORM use. */
  definePolicy: policyApi.definePolicy
} as const

/** Migration authoring + workflow. */
export const migrations = {
  // authoring (migration files)
  defineMigration: migrationOps.defineMigration,
  schema: migrationOps.schema,
  /** Baseline-only bookkeeping for a change `schema()` can't render (pair with `runSql`). */
  stateOnly: migrationOps.stateOnly,
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
  renameConstraint: migrationOps.renameConstraint,
  renameTable: migrationOps.renameTable,
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
  renameApp: groupsApi.renameGroupApp,
  deploy: groupsApi.deployGroups,
  status: groupsApi.statusGroups
} as const
