import {joinColumn, joinTableName, pgIdent} from '@getcronit/pylon-ir'
import {sql, type Expression} from 'kysely'
import {Database, getDatabase} from './database.js'
import {entityFromDefinition} from './ir.js'
import {
  allModels,
  ColumnDefinition,
  getModelDefinition,
  ModelDefinition,
  RelationDefinition,
  resolveColumnSqlType
} from './registry.js'

type ColumnType = string | Expression<any>

/** A JS array default (`[]`, `['a','b']`) → a Postgres array literal (`'{}'`,
 *  `'{"a","b"}'`). Kysely can't render a JS array as an immediate default value,
 *  so array columns need the SQL literal. Each element is double-quoted + escaped,
 *  which Postgres accepts for text[] and numeric[] alike; empty is the common case. */
function pgArrayLiteral(arr: readonly unknown[]): string {
  const body = arr
    .map(v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
  return `'{${body}}'`
}

// Postgres-specific (dialect override point). This is the `db push` (kysely)
// type renderer — the runtime parallel to the migration DDL renderer in
// `@getcronit/pylon-ir` (`dialect.ts`/`ddl.ts`). A non-Postgres adapter would
// supply its own mapping here (`serial`/`bigserial`, `text[]`, `tsvector`).
function pgColumnType(col: ColumnDefinition): ColumnType {
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
      if (col.precision != null) {
        return col.scale != null
          ? `numeric(${col.precision}, ${col.scale})`
          : `numeric(${col.precision})`
      }
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
    case 'tsvector':
      return sql.raw('tsvector')
  }
}

async function createTable(db: Database, def: ModelDefinition): Promise<void> {
  let builder = db.kysely.schema.createTable(def.tableName).ifNotExists()

  for (const col of def.columns) {
    // Resolve FK column types against the target PK (e.g. cuid `text`) — the
    // stored type is a `bigint` fallback.
    const resolved = {...col, sqlType: resolveColumnSqlType(def, col)}
    builder = builder.addColumn(
      col.columnName,
      pgColumnType(resolved) as any,
      build => {
        let c = build
        // A stored generated column (e.g. a tsvector) owns its value entirely —
        // no PK/unique/default/notnull, just the GENERATED expression.
        if (col.generatedAs) {
          return c.generatedAlwaysAs(sql.raw(col.generatedAs)).stored()
        }
        if (col.primaryKey) c = c.primaryKey()
        else if (col.unique) c = c.unique()

        if (!col.autoIncrement) {
          if (!col.nullable && !col.primaryKey) c = c.notNull()
          if (col.defaultSql) c = c.defaultTo(sql.raw(col.defaultSql))
          else if (col.default !== undefined) {
            // A JS array default (`default: []`) can't be rendered as a Kysely
            // immediate value → compile it to a Postgres array literal (`'{}'`,
            // `'{"a","b"}'`). Everything else passes straight through.
            c =
              col.array && Array.isArray(col.default)
                ? c.defaultTo(sql.raw(pgArrayLiteral(col.default)))
                : c.defaultTo(col.default as any)
          }
        }

        if (col.check) c = c.check(sql.raw(col.check))
        return c
      }
    )
  }

  await builder.execute()
}

/**
 * Add each model's belongsTo foreign keys as a SECOND pass, after every table
 * exists. Inline `REFERENCES` in `CREATE TABLE` can't express a FK CYCLE (e.g.
 * `Product.groupOptionId → ProductOption.productId → Product`) — no table order
 * satisfies both — so the constraints are deferred to `ALTER TABLE`. Idempotent:
 * a duplicate constraint on a re-run of `push` is ignored.
 */
async function addForeignKeys(db: Database, def: ModelDefinition): Promise<void> {
  for (const rel of def.relations) {
    if (rel.kind !== 'belongsTo' || !rel.fkColumn) continue
    const targetDef = getModelDefinition(rel.target())
    if (!targetDef?.primaryKey) continue
    const col = def.columns.find(c => c.columnName === rel.fkColumn)
    try {
      await db.kysely.schema
        .alterTable(def.tableName)
        .addForeignKeyConstraint(
          pgIdent(`${def.tableName}_${rel.fkColumn}_fkey`),
          [rel.fkColumn],
          targetDef.tableName,
          [targetDef.primaryKey.columnName]
        )
        .onDelete(rel.onDelete ?? (col?.nullable ? 'set null' : 'cascade'))
        .execute()
    } catch (e) {
      // Re-run of `push`: the constraint already exists (duplicate_object). Ignore.
      if ((e as {code?: string})?.code !== '42710') throw e
    }
  }
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
      // Inverse side: accessor only — the canonical side synthesizes the table.
      if (rel.kind !== 'manyToMany' || rel.inverse) continue
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
        ownerType: pgColumnType({...ownerPk, autoIncrement: false}),
        ownerRef: `${def.tableName}.${ownerPk.columnName}`,
        targetTable: targetDef.tableName,
        targetColumn: rel.targetColumn ?? joinColumn(targetDef.tableName, targetPk.columnName),
        targetType: pgColumnType({...targetPk, autoIncrement: false}),
        targetRef: `${targetDef.tableName}.${targetPk.columnName}`
      })
    }
  }
  return plans
}

async function createJoinTable(db: Database, p: JoinTablePlan): Promise<void> {
  // Name the FK constraints EXPLICITLY (not column-level `.references()`, which
  // lets Postgres auto-name + silently truncate them to 63 chars — two long-named
  // join FKs then collapse to the same name). `pgIdent` keeps each ≤63 and unique,
  // and matches the names the migration/diff path generates (no spurious drift).
  const [ownerRefTable, ownerRefCol] = p.ownerRef.split('.')
  const [targetRefTable, targetRefCol] = p.targetRef.split('.')
  await db.kysely.schema
    .createTable(p.joinTable)
    .ifNotExists()
    .addColumn(p.ownerColumn, p.ownerType as any, c => c.notNull())
    .addColumn(p.targetColumn, p.targetType as any, c => c.notNull())
    .addForeignKeyConstraint(
      pgIdent(`${p.joinTable}_${p.ownerColumn}_fkey`),
      [p.ownerColumn],
      ownerRefTable,
      [ownerRefCol],
      cb => cb.onDelete('cascade')
    )
    .addForeignKeyConstraint(
      pgIdent(`${p.joinTable}_${p.targetColumn}_fkey`),
      [p.targetColumn],
      targetRefTable,
      [targetRefCol],
      cb => cb.onDelete('cascade')
    )
    .addUniqueConstraint(pgIdent(`${p.joinTable}_${p.ownerColumn}_${p.targetColumn}_key`), [
      p.ownerColumn,
      p.targetColumn
    ])
    .execute()
}

/** Is `sub` a subclass of `base` somewhere up its prototype chain? */
function isDescendant(sub: Function, base: Function): boolean {
  let proto = Object.getPrototypeOf(sub)
  while (proto && proto !== Function.prototype) {
    if (proto === base) return true
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

/**
 * Single-table inheritance: fold each STI base's subclasses into it. Subclasses
 * (models with `discriminatorValue` extending a base with `inheritance`) share
 * the base's table, so their OWN columns/relations are unioned onto a synthetic
 * base def (subclass columns forced nullable) and the subclass defs themselves
 * are dropped — the physical table is created ONCE. Non-STI models pass through.
 */
function foldSingleTableInheritance(models: ModelDefinition[]): ModelDefinition[] {
  const bases = models.filter(m => m.inheritance)
  if (!bases.length) return models

  const subs = new Set<ModelDefinition>()
  const merged = new Map<ModelDefinition, ModelDefinition>()
  for (const base of bases) {
    const group = models.filter(
      m =>
        m.discriminatorValue !== undefined &&
        m.ctor !== base.ctor &&
        isDescendant(m.ctor, base.ctor)
    )
    const cols = new Map(base.columns.map(c => [c.columnName, c]))
    const rels = new Map(base.relations.map(r => [r.propertyKey, r]))
    for (const sub of group) {
      subs.add(sub)
      for (const c of sub.columns)
        if (!cols.has(c.columnName)) cols.set(c.columnName, {...c, nullable: true})
      for (const r of sub.relations)
        if (!rels.has(r.propertyKey)) rels.set(r.propertyKey, r)
    }
    merged.set(base, {...base, columns: [...cols.values()], relations: [...rels.values()]})
  }
  return models
    .filter(m => !subs.has(m))
    .map(m => merged.get(m) ?? m)
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
  models = foldSingleTableInheritance(models)
  // 1. All tables first (no FKs) — so a FK cycle between two tables can't wedge
  //    the create order. 2. Then the FK constraints, once every table exists.
  for (const def of orderByDependencies(models)) {
    await createTable(db, def)
  }
  for (const def of models) {
    await addForeignKeys(db, def)
  }
  // m2m join tables reference both sides, so create them after all base tables.
  for (const plan of joinTablePlans(models)) {
    await createJoinTable(db, plan)
  }
  // Secondary indexes (composite/unique from `indexes`, single from `{index}`,
  // and the auto GIN for tsvector). Reuse the IR's resolved index list so push
  // stays faithful to migrations.
  for (const def of models) {
    for (const ix of entityFromDefinition(def).indexes ?? []) {
      // Operator-class indexes (e.g. `gin_trgm_ops`) can't be expressed through
      // kysely's `.columns()` — emit raw DDL, and ensure the backing extension.
      if (ix.ops) {
        if (ix.ops === 'gin_trgm_ops') {
          await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db.kysely)
        }
        const method = ix.method && ix.method !== 'btree' ? sql.raw(` USING ${ix.method}`) : sql.raw('')
        const cols = sql.join(ix.columns.map(c => sql`${sql.ref(c)} ${sql.raw(ix.ops!)}`))
        await sql`CREATE INDEX IF NOT EXISTS ${sql.ref(ix.name)} ON ${sql.ref(ix.table)}${method} (${cols})`.execute(
          db.kysely
        )
        continue
      }
      let b = db.kysely.schema
        .createIndex(ix.name)
        .on(ix.table)
        .ifNotExists()
        .columns(ix.columns)
      if (ix.unique) b = b.unique()
      if (ix.method && ix.method !== 'btree') b = b.using(ix.method)
      await b.execute()
    }
  }
}

export async function dropTables(
  models: ModelDefinition[] = allModels()
): Promise<void> {
  const db = getDatabase()
  models = foldSingleTableInheritance(models)
  for (const plan of joinTablePlans(models)) {
    await db.kysely.schema.dropTable(plan.joinTable).ifExists().cascade().execute()
  }
  for (const def of models) {
    await db.kysely.schema.dropTable(def.tableName).ifExists().cascade().execute()
  }
}
