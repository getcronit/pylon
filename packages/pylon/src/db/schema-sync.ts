import {
  joinColumn,
  joinTableName,
  pgIdent,
  postgres,
  sqlDefaultLiteral,
  type PhysicalTable,
  type TableColumn
} from '../ir'
import {sql, type Expression, type ColumnDefinitionBuilder} from 'kysely'
import consola from 'consola'
import {Database, getDatabase} from './database.js'
import {entityFromDefinition} from './ir.js'
import {introspectPhysical} from './introspect.js'
import {
  allModels,
  ColumnDefinition,
  getModelDefinition,
  ModelDefinition,
  RelationDefinition,
  resolveColumnSqlType
} from './registry.js'

type ColumnType = string | Expression<any>


// Postgres-specific (dialect override point). This is the `db push` (kysely)
// type renderer — the runtime parallel to the migration DDL renderer in
// `@getcronit/pylon/ir` (`dialect.ts`/`ddl.ts`). A non-Postgres adapter would
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
    case 'vector':
      return sql.raw(`vector(${col.dim})`)
  }
}

/**
 * Apply a column's modifiers (generated / PK / unique / not-null / default / check) to a kysely
 * column builder. Shared by `CREATE TABLE` and the `ALTER TABLE … ADD COLUMN` convergence pass
 * ({@link addMissingColumns}) so both render a column from the SAME model definition identically.
 */
function buildColumn(
  build: ColumnDefinitionBuilder,
  def: ModelDefinition,
  col: ColumnDefinition
): ColumnDefinitionBuilder {
  const resolved = {...col, sqlType: resolveColumnSqlType(def, col)}
  let c = build
  // A stored generated column (e.g. a tsvector) owns its value entirely — no
  // PK/unique/default/notnull, just the GENERATED expression.
  if (col.generatedAs) return c.generatedAlwaysAs(sql.raw(col.generatedAs)).stored()
  if (col.primaryKey) c = c.primaryKey()
  else if (col.unique) c = c.unique()

  if (!col.autoIncrement) {
    if (!col.nullable && !col.primaryKey) c = c.notNull()
    if (col.defaultSql) c = c.defaultTo(sql.raw(col.defaultSql))
    else if (col.default !== undefined) {
      // Render through the SAME literal renderer the migration DDL uses, so `db push`
      // and a generated migration can't disagree about a model. Kysely can render
      // neither a JS array nor a plain object as an immediate value — an object
      // silently became an unusable default.
      const literal = sqlDefaultLiteral(col.default, resolved)
      c = literal != null ? c.defaultTo(sql.raw(literal)) : c.defaultTo(col.default as any)
    }
  }

  if (col.check) c = c.check(sql.raw(col.check))
  return c
}

async function createTable(db: Database, def: ModelDefinition): Promise<void> {
  let builder = db.kysely.schema.createTable(def.tableName).ifNotExists()

  for (const col of def.columns) {
    // Resolve FK column types against the target PK (e.g. cuid `text`) — the
    // stored type is a `bigint` fallback.
    const resolved = {...col, sqlType: resolveColumnSqlType(def, col)}
    builder = builder.addColumn(col.columnName, pgColumnType(resolved) as any, build =>
      buildColumn(build, def, col)
    )
  }

  await builder.execute()
}

/**
 * Converge an EXISTING table to its model: `ALTER TABLE … ADD COLUMN` for every model column the live
 * table lacks. `createTable().ifNotExists()` only ever CREATEs a whole missing table — it is a no-op
 * on a table that already exists, so a newly-added model field never got its column (push reported
 * success, then queries failed `column "x" does not exist`). This is the additive half of a
 * Prisma-style `db push`.
 *
 * `live` is the set of column names already on the table (empty for a table that didn't exist before
 * this push → no-op, since `createTable` just made it whole). Runs BEFORE the foreign-key pass so a
 * new FK column exists before its `ADD CONSTRAINT`.
 *
 * NOT NULL without a default can't be added to a table that already holds rows, so such a column is
 * added NULLABLE with a warning — the real NOT NULL (and any backfill) belongs in a migration. A new
 * PRIMARY KEY on an existing table is likewise a migration concern and is skipped.
 */
async function addMissingColumns(db: Database, def: ModelDefinition, live: Set<string>): Promise<void> {
  for (const col of def.columns) {
    if (live.has(col.columnName)) continue
    if (col.primaryKey) {
      consola.warn(
        `db push: not adding new PRIMARY KEY column ${def.tableName}.${col.columnName} to an existing table — use a migration.`
      )
      continue
    }
    const resolved = {...col, sqlType: resolveColumnSqlType(def, col)}
    // A plain NOT NULL add (no default, not serial/generated) fails on a non-empty table → relax to
    // nullable for the push and warn; the migration carries the enforced NOT NULL + backfill.
    const relax =
      !col.nullable && col.default === undefined && !col.defaultSql && !col.autoIncrement && !col.generatedAs
    const effective = relax ? {...col, nullable: true} : col
    try {
      await db.kysely.schema
        .alterTable(def.tableName)
        .addColumn(col.columnName, pgColumnType(resolved) as any, build => buildColumn(build, def, effective))
        .execute()
      if (relax) {
        consola.warn(
          `db push: added ${def.tableName}.${col.columnName} as NULLABLE — NOT NULL needs a column default or a migration backfill.`
        )
      }
    } catch (e) {
      // 42701 = duplicate_column: a concurrent/idempotent re-add. Anything else is real.
      if ((e as {code?: string})?.code !== '42701') throw e
    }
  }
}

/**
 * Report (non-destructively) columns the DB still has but the models no longer define — drift from a
 * removed field. push NEVER drops here (that is `--force`/migration territory): data loss must be
 * explicit. But a leftover NOT NULL column blocks every insert (the model stops supplying it), so it
 * is relaxed to NULLABLE — reversible, data-preserving — and all orphans are logged so the drift is
 * visible. Only tables the models own are inspected; extra TABLES (another app's, in a shared DB) are
 * never touched.
 */
async function reconcileOrphanColumns(
  db: Database,
  def: ModelDefinition,
  live: PhysicalTable,
  dropped: ReadonlySet<string>
): Promise<void> {
  const want = new Set(def.columns.map(c => c.columnName))
  const orphans = live.columns.filter(
    (c: TableColumn) => !want.has(c.name) && !dropped.has(`${def.tableName}.${c.name}`)
  )
  for (const o of orphans) {
    if (!o.nullable) {
      await db.kysely.schema.alterTable(def.tableName).alterColumn(o.name, b => b.dropNotNull()).execute()
      consola.warn(
        `db push: ${def.tableName}.${o.name} is no longer in the model — relaxed to NULLABLE (kept, not dropped). Remove it with a migration.`
      )
    } else {
      consola.warn(
        `db push: ${def.tableName}.${o.name} is no longer in the model (left in place). Remove it with a migration.`
      )
    }
  }
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
 * The DESTRUCTIVE half of `db push`, supplied as an explicit PLAN by the caller (the CLI, from
 * interactive prompts or `--force`/`--rename` flags) — never inferred by the engine. Default push
 * (no plan) stays purely additive + non-destructive (Stage 1).
 */
export interface SyncOptions {
  /**
   * Data-preserving column renames (`ALTER TABLE … RENAME COLUMN from TO to`), applied BEFORE the
   * additive pass so the renamed column isn't re-added empty and its old name isn't reported as an
   * orphan. A rename is how an operator says "this dropped column is actually that new one".
   */
  renames?: Array<{table: string; from: string; to: string}>
  /** Orphan columns to DROP (data loss). Surgical: only these are dropped — orphans left off the list
   *  are kept and (if NOT NULL) relaxed, exactly as a plain push would. */
  dropColumns?: Array<{table: string; column: string}>
  /** Orphan TABLES to DROP (data loss). Empty unless the operator explicitly opted in per table —
   *  never populated by drift alone, because a shared database legitimately holds other apps' tables. */
  dropTables?: string[]
}

/** Apply the caller's data-preserving column renames. Idempotent/tolerant: a `from` that's already
 *  gone or a `to` that already exists (a re-run after the rename landed) is logged, not fatal. */
async function applyRenames(db: Database, renames: NonNullable<SyncOptions['renames']>): Promise<void> {
  for (const r of renames) {
    try {
      await db.kysely.schema.alterTable(r.table).renameColumn(r.from, r.to).execute()
      consola.info(`db push: renamed ${r.table}.${r.from} → ${r.to} (data preserved).`)
    } catch (e) {
      // 42703 undefined_column (from already renamed/absent) or 42701 duplicate_column (to exists).
      const code = (e as {code?: string})?.code
      if (code === '42703' || code === '42701') {
        consola.warn(`db push: rename ${r.table}.${r.from} → ${r.to} skipped (already applied or source missing).`)
      } else throw e
    }
  }
}

/** Apply the caller's explicit drops (data loss). Columns first, then tables. */
async function applyDrops(
  db: Database,
  dropColumns: NonNullable<SyncOptions['dropColumns']>,
  dropTables: NonNullable<SyncOptions['dropTables']>
): Promise<ReadonlySet<string>> {
  const dropped = new Set<string>()
  for (const d of dropColumns) {
    try {
      await db.kysely.schema.alterTable(d.table).dropColumn(d.column).execute()
      dropped.add(`${d.table}.${d.column}`)
      consola.warn(`db push: dropped column ${d.table}.${d.column} (data loss).`)
    } catch (e) {
      if ((e as {code?: string})?.code !== '42703') throw e // already gone
      dropped.add(`${d.table}.${d.column}`)
    }
  }
  for (const t of dropTables) {
    await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    consola.warn(`db push: dropped table ${t} (data loss).`)
  }
  return dropped
}

/**
 * Create tables for the given models (defaults to all registered models).
 * This is a stop-gap for tests and early development — the real, snapshot-diffed
 * migration engine is Phase 4.
 */
export async function syncSchema(
  models: ModelDefinition[] = allModels(),
  opts: SyncOptions = {}
): Promise<void> {
  const db = getDatabase()
  models = foldSingleTableInheritance(models)
  // pgvector: the `vector(N)` column type needs its extension to EXIST before any
  // CREATE TABLE references it (unlike pg_trgm, which an index needs later — see
  // the index loop below). Install it up-front when any model declares a vector
  // column. Idempotent (`IF NOT EXISTS`).
  if (models.some(def => def.columns.some(c => c.sqlType === 'vector'))) {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db.kysely)
  }
  // 1. All tables first (no FKs) — so a FK cycle between two tables can't wedge
  //    the create order. 2. Then the FK constraints, once every table exists.
  for (const def of orderByDependencies(models)) {
    await createTable(db, def)
  }
  // 1a. Data-preserving RENAMEs the caller confirmed — BEFORE the snapshot, so the renamed column is
  //     seen as present (not re-added) and its old name isn't reported as an orphan.
  if (opts.renames?.length) await applyRenames(db, opts.renames)
  // 1b. Converge EXISTING tables to their models: ADD any model column the live table lacks. Snapshot
  //     the live schema once (now that createTable made new tables whole) and reuse it for the orphan
  //     pass below. This runs BEFORE the FK pass so a new FK column exists before its ADD CONSTRAINT.
  const physical = await introspectPhysical(db)
  const liveByTable = new Map(Object.values(physical).map(t => [t.table, t]))
  for (const def of models) {
    const live = liveByTable.get(def.tableName)
    await addMissingColumns(db, def, new Set(live?.columns.map(c => c.name) ?? []))
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
        // Storage params (HNSW `m`/`ef_construction`, …) via the shared, validated
        // dialect renderer — same clause the migration DDL emits.
        const withClause = sql.raw(postgres.indexWith(ix.with))
        await sql`CREATE INDEX IF NOT EXISTS ${sql.ref(ix.name)} ON ${sql.ref(ix.table)}${method} (${cols})${withClause}`.execute(
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
  // Explicit DROPs the caller approved (data loss) — surgical: only the listed columns/tables.
  const dropped = await applyDrops(db, opts.dropColumns ?? [], opts.dropTables ?? [])
  // Drift report (non-destructive): columns the DB still has but the models dropped and the caller did
  // NOT drop. Never drops here — only relaxes a leftover NOT NULL (so it can't block inserts) and logs.
  // Uses the pre-ADD snapshot (added columns are in the model, so never flagged). Extra TABLES are left
  // alone (shared DB).
  for (const def of models) {
    const live = liveByTable.get(def.tableName)
    if (live) await reconcileOrphanColumns(db, def, live, dropped)
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

/**
 * Full clean slate: drop and recreate a schema (default `public`). Removes ALL
 * tables, the migration ledger (`_pylon_migrations`), sequences, and enum types —
 * including tables orphaned by a previous migration history that a model-scoped
 * `dropTables` would miss. Backs `pylon db reset` (Prisma's `migrate reset` drop
 * step). DESTRUCTIVE and dev-oriented: the CLI gates it behind a production guard +
 * confirmation. Note it also drops any NON-pylon objects living in the schema.
 */
export async function resetSchema(schema = 'public'): Promise<void> {
  const db = getDatabase()
  const ident = sql.id(schema)
  await sql`drop schema if exists ${ident} cascade`.execute(db.kysely)
  await sql`create schema ${ident}`.execute(db.kysely)
}
