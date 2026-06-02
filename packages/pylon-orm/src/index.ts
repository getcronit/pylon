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
  type ModelOptions,
  type FieldOptions
} from './decorators.js'
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
  type SqlType
} from './registry.js'

/** Build a custom manager: `static objects = manager(User)`. */
import {createManager} from './manager.js'
import type {ModelCtor, Manager} from './manager.js'
export function manager<T extends object>(ctor: ModelCtor<T>): Manager<T> {
  return createManager(ctor)
}
