import {sql, type Expression} from 'kysely'
import {Database, getDatabase} from './database.js'
import {
  allModels,
  ColumnDefinition,
  getModelDefinition,
  ModelDefinition,
  RelationDefinition
} from './registry.js'

type ColumnType = string | Expression<any>

function columnType(col: ColumnDefinition): ColumnType {
  if (col.array) {
    const base = col.sqlType === 'varchar' ? `varchar(${col.length ?? 255})` : col.sqlType
    return sql.raw(`${base}[]`) // kysely needs a raw expression for array types
  }
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

  // Map each FK column to its belongsTo relation so we can add a REFERENCES.
  const fkByColumn = new Map<string, RelationDefinition>()
  for (const rel of def.relations) {
    if (rel.kind === 'belongsTo' && rel.fkColumn) {
      fkByColumn.set(rel.fkColumn, rel)
    }
  }

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

        if (col.check) c = c.check(sql.raw(col.check))

        const rel = fkByColumn.get(col.columnName)
        if (rel) {
          const targetDef = getModelDefinition(rel.target())
          if (targetDef?.primaryKey) {
            c = c
              .references(
                `${targetDef.tableName}.${targetDef.primaryKey.columnName}`
              )
              .onDelete(rel.onDelete ?? (col.nullable ? 'set null' : 'cascade'))
          }
        }
        return c
      }
    )
  }

  await builder.execute()
}

/**
 * Order models so that a table is created after the tables it references via a
 * belongsTo foreign key (parents before children). Cycles and self-references
 * are tolerated — they simply don't constrain the order.
 */
function orderByDependencies(models: ModelDefinition[]): ModelDefinition[] {
  const byCtor = new Map(models.map(m => [m.ctor, m]))
  const result: ModelDefinition[] = []
  const visiting = new Set<ModelDefinition>()
  const visited = new Set<ModelDefinition>()

  const visit = (def: ModelDefinition): void => {
    if (visited.has(def) || visiting.has(def)) return
    visiting.add(def)
    for (const rel of def.relations) {
      if (rel.kind !== 'belongsTo') continue
      const dep = byCtor.get(rel.target())
      if (dep && dep !== def) visit(dep)
    }
    visiting.delete(def)
    visited.add(def)
    result.push(def)
  }

  for (const def of models) visit(def)
  return result
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
  for (const def of orderByDependencies(models)) {
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
