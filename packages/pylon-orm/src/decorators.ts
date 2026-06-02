import {createManager} from './manager.js'
import {
  ColumnDefinition,
  finalizeModel,
  registerColumn,
  SqlType
} from './registry.js'
import {snakeCase} from './util.js'

export interface ModelOptions {
  /** Override the table name (defaults to snake_case of the class name). */
  table?: string
  /** Abstract base model: contributes columns to subclasses but has no table. */
  abstract?: boolean
}

export function model(options: ModelOptions = {}): ClassDecorator {
  return (ctor: Function) => {
    const tableName = options.table ?? snakeCase(ctor.name)
    finalizeModel(ctor, {tableName, abstract: options.abstract ?? false})

    if (!options.abstract) {
      // Default manager. A custom `static objects = manager(...)` declared on the
      // class is an own property and therefore wins over this assignment.
      if (!Object.prototype.hasOwnProperty.call(ctor, 'objects')) {
        Object.defineProperty(ctor, 'objects', {
          value: createManager(ctor as any),
          writable: false,
          enumerable: false,
          configurable: true
        })
      }
    }
  }
}

export interface FieldOptions {
  /** Override the column name. */
  column?: string
  unique?: boolean
  nullable?: boolean
  primaryKey?: boolean
  /** Literal default applied on insert. */
  default?: unknown
  /** Raw SQL default, e.g. `now()`. */
  defaultSql?: string
  /** Force hidden from the generated GraphQL API. */
  hidden?: boolean
}

function defineField(
  sqlType: SqlType,
  base: Partial<ColumnDefinition>,
  options: FieldOptions & {length?: number} = {}
): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const key = String(propertyKey)
    const exposedName = key.startsWith('$') ? key.slice(1) : key
    const column: ColumnDefinition = {
      propertyKey: key,
      columnName: options.column ?? snakeCase(exposedName),
      sqlType,
      primaryKey: options.primaryKey ?? base.primaryKey ?? false,
      autoIncrement: base.autoIncrement ?? false,
      unique: options.unique ?? base.unique ?? false,
      nullable: options.nullable ?? false,
      hidden: options.hidden ?? key.startsWith('$'),
      length: options.length,
      default: options.default,
      defaultSql: options.defaultSql ?? base.defaultSql
    }
    registerColumn(target.constructor, column)
  }
}

/** Auto-incrementing integer primary key. */
export function id(options: FieldOptions = {}): PropertyDecorator {
  return defineField(
    'bigint',
    {primaryKey: true, autoIncrement: true},
    options
  )
}

/** UUID column (use `{primaryKey: true}` for a uuid PK with a server default). */
export function uuid(options: FieldOptions = {}): PropertyDecorator {
  const base: Partial<ColumnDefinition> = {}
  if (options.primaryKey) base.defaultSql = 'gen_random_uuid()'
  return defineField('uuid', base, options)
}

export function text(options: FieldOptions = {}): PropertyDecorator {
  return defineField('text', {}, options)
}

export function varchar(
  length: number,
  options: FieldOptions = {}
): PropertyDecorator {
  return defineField('varchar', {}, {...options, length})
}

export function int(options: FieldOptions = {}): PropertyDecorator {
  return defineField('integer', {}, options)
}

export function bigint(options: FieldOptions = {}): PropertyDecorator {
  return defineField('bigint', {}, options)
}

export function numeric(options: FieldOptions = {}): PropertyDecorator {
  return defineField('numeric', {}, options)
}

export function boolean(options: FieldOptions = {}): PropertyDecorator {
  return defineField('boolean', {}, options)
}

export function timestamp(options: FieldOptions = {}): PropertyDecorator {
  return defineField('timestamptz', {}, options)
}

export function date(options: FieldOptions = {}): PropertyDecorator {
  return defineField('date', {}, options)
}

export function json(options: FieldOptions = {}): PropertyDecorator {
  return defineField('jsonb', {}, options)
}
