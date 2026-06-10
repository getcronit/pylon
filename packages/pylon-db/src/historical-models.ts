/**
 * Historical models — the decoupled, replay-safe way to touch data inside a
 * migration (Django's `apps.get_model()` equivalent).
 *
 * A data migration must NOT import the live model classes: a migration is an
 * immutable historical record, so coupling it to current code breaks the moment
 * a model is renamed or removed (a fresh-DB replay can't even load the file).
 * Instead, the migration runner reconstructs the schema *as of that migration*
 * by folding the named schema operations' changes (see `applyChanges`), and
 * hands a `run` handler models built from that historical state:
 *
 * ```ts
 * migrations.run({
 *   up: async ({models}) => {
 *     const Product = models.get('Product')
 *     await Product.objects.create({title: 'x', categoryId: 1})
 *   }
 * })
 * ```
 *
 * The returned model exposes the same `.objects` manager as a live model, but
 * its shape comes from migration history, not `models.ts`. (Like Django's
 * historical models, it has columns + a manager only — no custom methods. And
 * tables created via raw `runSql` aren't tracked, since they carry no IR state.)
 */
import type {PhysicalSchema, TableColumn, TableSpec} from '@getcronit/pylon-ir'
import {createManager, type Manager} from './manager.js'
import {Model} from './model.js'
import {registerModelDefinition, type ColumnDefinition, type ModelDefinition} from './registry.js'

export interface HistoricalModel<Row extends object = any> {
  /** The query manager for this historical model — same API as a live model. */
  objects: Manager<Row>
}

export interface HistoricalModels {
  /** Get the model named `name` as it existed at this point in history. */
  get<Row extends object = any>(name: string): HistoricalModel<Row>
}

function columnDefFromSpec(col: TableColumn): ColumnDefinition {
  return {
    propertyKey: col.property,
    columnName: col.name,
    sqlType: col.sqlType,
    primaryKey: col.primaryKey,
    autoIncrement: col.autoIncrement,
    unique: col.unique,
    nullable: col.nullable,
    hidden: false,
    length: col.length,
    default: col.default,
    defaultSql: col.defaultSql
  }
}

function definitionFromTableSpec(spec: TableSpec, ctor: Function): ModelDefinition {
  const columns = spec.columns.map(columnDefFromSpec)
  return {
    ctor,
    tableName: spec.table,
    abstract: false,
    columns,
    relations: [],
    primaryKey: columns.find(c => c.primaryKey)
  }
}

/** Build the historical-model registry for a reconstructed schema state. */
export function buildHistoricalModels(tables: PhysicalSchema): HistoricalModels {
  const cache = new Map<string, HistoricalModel>()
  return {
    get<Row extends object = any>(name: string): HistoricalModel<Row> {
      const hit = cache.get(name)
      if (hit) return hit as HistoricalModel<Row>

      const spec = tables[name]
      if (!spec) {
        throw new Error(
          `No historical model "${name}" at this point in the migration history. ` +
            `Historical models are reconstructed from schema operations — tables ` +
            `created with raw runSql carry no IR state and aren't tracked.`
        )
      }

      // A fresh synthetic ctor per model, extending Model so instances get
      // $save/$delete, registered so the Manager/QuerySet machinery resolves it
      // exactly like a decorated model.
      const ctor = class extends Model {} as unknown as {new (): Row}
      Object.defineProperty(ctor, 'name', {value: name})
      registerModelDefinition(ctor as Function, definitionFromTableSpec(spec, ctor as Function))

      const handle: HistoricalModel<Row> = {objects: createManager(ctor)}
      cache.set(name, handle)
      return handle
    }
  }
}
