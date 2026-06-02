import {sql, type Expression} from 'kysely'
import {Database, getDatabase} from './database.js'
import {allModels, ColumnDefinition, ModelDefinition} from './registry.js'

type ColumnType = string | Expression<any>

function columnType(col: ColumnDefinition): ColumnType {
  switch (col.sqlType) {
    case 'text':
      return 'text'
    case 'varchar':
      return `varchar(${col.length ?? 255})`
    case 'integer':
      return col.autoIncrement ? sql`serial` : 'integer'
    case 'bigint':
      return col.autoIncrement ? sql`bigserial` : 'bigint'
    case 'numeric':
      return 'numeric'
    case 'boolean':
      return 'boolean'
    case 'timestamptz':
      return 'timestamptz'
    case 'date':
      return 'date'
    case 'jsonb':
      return 'jsonb'
    case 'uuid':
      return 'uuid'
  }
}

async function createTable(db: Database, def: ModelDefinition): Promise<void> {
  let builder = db.kysely.schema.createTable(def.tableName).ifNotExists()

  for (const col of def.columns) {
    builder = builder.addColumn(
      col.columnName,
      columnType(col) as any,
      build => {
        let c = build
        if (col.primaryKey) c = c.primaryKey()
        else if (col.unique) c = c.unique()

        if (!col.autoIncrement) {
          if (!col.nullable && !col.primaryKey) c = c.notNull()
          if (col.defaultSql) c = c.defaultTo(sql.raw(col.defaultSql))
          else if (col.default !== undefined) c = c.defaultTo(col.default as any)
        }
        return c
      }
    )
  }

  await builder.execute()
}

/**
 * Create tables for the given models (defaults to all registered models).
 * This is a stop-gap for tests and early development — the real, snapshot-diffed
 * migration engine is Phase 4.
 */
export async function syncSchema(
  models: ModelDefinition[] = allModels()
): Promise<void> {
  const db = getDatabase()
  for (const def of models) {
    await createTable(db, def)
  }
}

export async function dropTables(
  models: ModelDefinition[] = allModels()
): Promise<void> {
  const db = getDatabase()
  for (const def of models) {
    await db.kysely.schema.dropTable(def.tableName).ifExists().cascade().execute()
  }
}
