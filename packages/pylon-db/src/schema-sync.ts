import {joinColumn, joinTableName} from '@getcronit/pylon-ir'
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

/** The synthesized join table backing one `manyToMany` relation, or null. */
interface JoinTablePlan {
  joinTable: string
  ownerTable: string
  ownerColumn: string
  ownerType: ColumnType
  ownerRef: string
  targetTable: string
  targetColumn: string
  targetType: ColumnType
  targetRef: string
}

/** Plan the unique set of m2m join tables across `models` (deduped by name). */
function joinTablePlans(models: ModelDefinition[]): JoinTablePlan[] {
  const byCtor = new Map(models.map(m => [m.ctor, m]))
  const seen = new Set<string>()
  const plans: JoinTablePlan[] = []
  for (const def of models) {
    const ownerPk = def.primaryKey
    if (!ownerPk) continue
    for (const rel of def.relations) {
      if (rel.kind !== 'manyToMany') continue
      const targetDef = byCtor.get(rel.target()) ?? getModelDefinition(rel.target())
      const targetPk = targetDef?.primaryKey
      if (!targetDef || !targetPk) continue
      const joinTable = joinTableName(def.tableName, targetDef.tableName, rel.through)
      if (seen.has(joinTable)) continue
      seen.add(joinTable)
      // The join FK columns mirror the referenced PK's *stored* type (a
      // bigserial PK is stored as bigint, so strip auto-increment).
      plans.push({
        joinTable,
        ownerTable: def.tableName,
        ownerColumn: rel.sourceColumn ?? joinColumn(def.tableName, ownerPk.columnName),
        ownerType: columnType({...ownerPk, autoIncrement: false}),
        ownerRef: `${def.tableName}.${ownerPk.columnName}`,
        targetTable: targetDef.tableName,
        targetColumn: rel.targetColumn ?? joinColumn(targetDef.tableName, targetPk.columnName),
        targetType: columnType({...targetPk, autoIncrement: false}),
        targetRef: `${targetDef.tableName}.${targetPk.columnName}`
      })
    }
  }
  return plans
}

async function createJoinTable(db: Database, p: JoinTablePlan): Promise<void> {
  await db.kysely.schema
    .createTable(p.joinTable)
    .ifNotExists()
    .addColumn(p.ownerColumn, p.ownerType as any, c =>
      c.notNull().references(p.ownerRef).onDelete('cascade')
    )
    .addColumn(p.targetColumn, p.targetType as any, c =>
      c.notNull().references(p.targetRef).onDelete('cascade')
    )
    .addUniqueConstraint(`${p.joinTable}_${p.ownerColumn}_${p.targetColumn}_key`, [
      p.ownerColumn,
      p.targetColumn
    ])
    .execute()
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
  // m2m join tables reference both sides, so create them after all base tables.
  for (const plan of joinTablePlans(models)) {
    await createJoinTable(db, plan)
  }
}

export async function dropTables(
  models: ModelDefinition[] = allModels()
): Promise<void> {
  const db = getDatabase()
  for (const plan of joinTablePlans(models)) {
    await db.kysely.schema.dropTable(plan.joinTable).ifExists().cascade().execute()
  }
  for (const def of models) {
    await db.kysely.schema.dropTable(def.tableName).ifExists().cascade().execute()
  }
}
