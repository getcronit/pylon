/**
 * Migration round-trip harness — the property-based safety net for the migration
 * pipeline. It drives the real generate → apply → rollback → re-apply loop against
 * a live Postgres and asserts three invariants at every step:
 *
 *   1. CONVERGENCE (in-memory, lossless): after generating + applying the delta
 *      for a model state, `status().pendingChanges` is empty — i.e. the folded
 *      migration history reproduces the current models EXACTLY (types, unique,
 *      defaults, indexes, FKs). This is the primary diff-engine bug catcher: a
 *      generate() that emits an incomplete or wrong delta fails here immediately.
 *
 *   2. DB SHAPE (real Postgres): after applying, the live database's table/column
 *      structure matches the model state. This is what convergence CANNOT prove —
 *      that the generated SQL, actually executed by Postgres, produced the shape
 *      the diff claimed. Catches DDL-rendering bugs (a change the fold "applies"
 *      in memory but whose SQL does something else, or fails to run).
 *
 *   3. REVERSIBILITY (real Postgres): rolling the whole history back drops every
 *      table (no orphaned objects), and re-applying rebuilds the exact same shape.
 *      Catches asymmetric / missing `down` handlers.
 *
 * A seeded random walk (`randomWalk`) mutates a small model space — add/drop
 * table, add/drop/alter/rename column, add/drop index, add/drop FK — so a fuzz
 * run explores diff paths no hand-written scenario would. Everything is
 * deterministic given the seed, so a failure reproduces from its seed alone.
 */
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {expect} from 'vitest'
import {sql} from 'kysely'
import {
  physicalSchemaOf,
  type Entity,
  type Field,
  type IndexSpec,
  type PhysicalSchema,
  type Rename,
  type SqlType,
  type TableRename
} from '@getcronit/pylon-ir'
import {
  MigrationRunner,
  introspectPhysical,
  type Database,
  type MigrationLoader,
  type Snapshot
} from '../../src/index'

// Migration files are TS; vitest transpiles them on import, so the loader is a
// plain dynamic import of the file's default export (same as the runner IT).
export const load: MigrationLoader = async filePath =>
  (await import(pathToFileURL(filePath).href)).default

// ── Deterministic PRNG ───────────────────────────────────────────────────────
// mulberry32 — small, seedable, good enough for fuzzing. A given seed always
// produces the same walk, so any failure reproduces from the seed printed by the
// test. (The workflow forbids Math.random for reproducibility; this replaces it.)
export function makeRng(seed: number): {
  next: () => number
  int: (n: number) => number
  pick: <T>(xs: readonly T[]) => T
  bool: () => boolean
} {
  let a = seed >>> 0
  const next = (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number): number => Math.floor(next() * n)
  return {next, int, pick: xs => xs[int(xs.length)], bool: () => next() < 0.5}
}

// ── State builders ───────────────────────────────────────────────────────────
// A "state" is a Snapshot ({version, entities}) — the same currency the runner
// diffs. Builders mirror the shapes the real IR emits (see the squash IT), so a
// hand-built state and a compiler-built one are indistinguishable to the diff.

const gqlName: Record<SqlType, string> = {
  text: 'String',
  varchar: 'String',
  integer: 'Int',
  bigint: 'Int',
  numeric: 'Float',
  boolean: 'Boolean',
  timestamptz: 'String',
  date: 'String',
  jsonb: 'JSON',
  uuid: 'String',
  tsvector: 'String',
  vector: 'JSON'
}

/** The `bigint` auto-increment primary key every entity carries. */
export function idField(): Field {
  return {
    name: 'id',
    type: {kind: 'scalar', name: 'ID', nullable: false} as never,
    exposed: true,
    column: {
      name: 'id',
      sqlType: 'bigint',
      primaryKey: true,
      autoIncrement: true,
      unique: false,
      nullable: false
    }
  }
}

/** A plain persisted scalar column. `col` is the snake_case column name. */
export function scalarField(
  name: string,
  col: string,
  sqlType: SqlType,
  opts: {nullable?: boolean; unique?: boolean} = {}
): Field {
  return {
    name,
    type: {kind: 'scalar', name: gqlName[sqlType], nullable: opts.nullable ?? false} as never,
    exposed: true,
    column: {
      name: col,
      sqlType,
      primaryKey: false,
      autoIncrement: false,
      unique: opts.unique ?? false,
      nullable: opts.nullable ?? false
    }
  }
}

/**
 * A `belongsTo` relation field (no column of its own). Pairs with a scalar FK
 * column field named `fkField` — foreignKeysOf() resolves the two into an FK
 * constraint referencing `target`'s primary key.
 */
export function belongsToField(
  name: string,
  fkField: string,
  target: string,
  onDelete: 'cascade' | 'set null' | 'restrict' | 'no action' = 'cascade'
): Field {
  return {
    name,
    type: {kind: 'object', name: target, nullable: true} as never,
    exposed: true,
    relation: {kind: 'belongsTo', target, fkField, onDelete}
  }
}

export function entity(
  name: string,
  table: string,
  fields: Field[],
  indexes: IndexSpec[] = []
): Entity {
  return {
    name,
    table,
    abstract: false,
    primaryKey: 'id',
    implements: [],
    fields: [idField(), ...fields],
    // Deep-copy indexes so a snapshot is an immutable point-in-time capture. The
    // fuzzer's WorkEntity is a persistent mutable object; `addIndex` push-mutates
    // its `indexes` array in place, which would otherwise retroactively corrupt
    // every earlier snapshot that aliased the same array.
    ...(indexes.length ? {indexes: indexes.map(ix => ({...ix, columns: [...ix.columns]}))} : {})
  }
}

export function snap(entities: Entity[]): Snapshot {
  const map: Record<string, Entity> = {}
  for (const e of entities) map[e.name] = e
  return {version: 1, entities: map} as Snapshot
}

/** One step of a walk: the target model state plus any rename hints for the diff. */
export interface WalkStep {
  state: Snapshot
  renames?: Rename[]
  tableRenames?: TableRename[]
  /** Human label for the migration file / failure messages. */
  label: string
}

// ── DB-shape comparison ──────────────────────────────────────────────────────
// The live DB is introspected and compared to the model state by PHYSICAL TABLE
// (introspection keys by table name; the model schema keys by entity name — so we
// compare on `.table`). We assert the set of tables, the set of columns per table,
// and each column's nullability. We deliberately do NOT hard-assert sqlType or
// defaults here: introspection's type mapping is lossy (varchar length, numeric
// precision, identity columns) and those facets are already proven losslessly by
// the convergence invariant. This check's unique job is structural: did the SQL
// actually create the right tables and columns?

type ColShape = {nullable: boolean; unique: boolean}
type Shape = Map<string, Map<string, ColShape>>

function shapeOf(schema: PhysicalSchema): Shape {
  const out: Shape = new Map()
  for (const t of Object.values(schema)) {
    const cols = new Map<string, ColShape>()
    // `unique` round-trips: introspect folds single-column UNIQUE constraints onto
    // the column, so comparing it catches constraint DRIFT (e.g. a renamed unique
    // column whose old-named constraint lingers).
    for (const c of t.columns) cols.set(c.name, {nullable: c.nullable, unique: c.unique})
    out.set(t.table, cols)
  }
  return out
}

function shapeToObject(shape: Shape): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const [table, cols] of [...shape].sort((a, b) => a[0].localeCompare(b[0]))) {
    const c: Record<string, string> = {}
    for (const [name, s] of [...cols].sort((a, b) => a[0].localeCompare(b[0]))) {
      c[name] = `nullable=${s.nullable} unique=${s.unique}`
    }
    out[table] = c
  }
  return out
}

/** Assert the live DB's table/column structure equals the expected model state. */
async function expectDbShape(db: Database, expected: PhysicalSchema, ctx: string): Promise<void> {
  const live = shapeToObject(shapeOf(await introspectPhysical(db)))
  const want = shapeToObject(shapeOf(expected))
  expect(live, `DB shape mismatch ${ctx}`).toEqual(want)
}

// ── DB reset ─────────────────────────────────────────────────────────────────
/** Drop every user table (and the ledger) so a round-trip starts from nothing. */
export async function resetDb(db: Database): Promise<void> {
  const rows = await sql<{table_name: string}>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `.execute(db.kysely)
  for (const {table_name} of rows.rows) {
    await sql.raw(`DROP TABLE IF EXISTS "${table_name}" CASCADE`).execute(db.kysely)
  }
}

// ── The round-trip ───────────────────────────────────────────────────────────
/**
 * Drive `steps` through generate → apply against a clean DB, asserting the
 * convergence + DB-shape invariants after each. Then roll the whole history back
 * (asserting the DB is empty) and re-apply it (asserting the DB shape is rebuilt).
 * Throws (via expect) on the first violated invariant; the caller's seed/label
 * pinpoints the reproduction.
 */
export async function runRoundTrip(opts: {
  db: Database
  steps: WalkStep[]
  dirPrefix?: string
}): Promise<void> {
  const {db, steps} = opts
  await resetDb(db)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), opts.dirPrefix ?? 'pylon-rt-'))

  try {
    let cur: Snapshot = {version: 1, entities: {}} as Snapshot
    let clock = 0
    const runner = new MigrationRunner({
      dir,
      current: () => cur,
      // zero-padded so >9 migrations still sort chronologically by file name
      now: () => `t${String(++clock).padStart(4, '0')}`
    })

    let appliedCount = 0
    for (const step of steps) {
      cur = step.state
      const gen = await runner.generate(step.label, load, {
        renames: step.renames,
        tableRenames: step.tableRenames
      })
      if (!gen) continue // no delta — nothing to apply, still converged
      appliedCount++

      await runner.apply(load, db)

      // 1. Convergence: the folded history reproduces the models exactly.
      const status = await runner.status(load, db)
      expect(status.pendingChanges, `not converged after "${step.label}"`).toEqual([])
      expect(status.unapplied, `unapplied migrations after "${step.label}"`).toEqual([])

      // 2. DB shape: the live database matches the model state.
      await expectDbShape(db, physicalSchemaOf(cur.entities), `after "${step.label}"`)
    }

    if (appliedCount === 0) return // degenerate walk (no changes) — nothing to reverse

    const finalSchema = physicalSchemaOf(cur.entities)

    // 3a. Reversibility: rolling the whole history back drops every table.
    const rolled = await runner.rollback(load, db, {steps: appliedCount})
    expect(rolled.length, 'rollback did not reverse the full history').toBe(appliedCount)
    await expectDbShape(db, {}, 'after full rollback')

    // 3b. Re-apply rebuilds the identical shape.
    await runner.apply(load, db)
    await expectDbShape(db, finalSchema, 'after re-apply')
    const reStatus = await runner.status(load, db)
    expect(reStatus.pendingChanges, 'not converged after re-apply').toEqual([])
  } finally {
    await fs.rm(dir, {recursive: true, force: true})
    await resetDb(db)
  }
}

// ── Fuzzer: a seeded random walk over a small model space ─────────────────────
// Entities are drawn from a fixed pool of names/tables so renames and re-adds can
// reuse them. Columns come from a fixed catalog so the walk can add/drop/alter/
// rename the same column across steps. Every mutation keeps the state a VALID
// schema (ids preserved, FKs only to existing entities).

const ENTITY_POOL = [
  {name: 'Alpha', table: 'alpha'},
  {name: 'Beta', table: 'beta'},
  {name: 'Gamma', table: 'gamma'},
  {name: 'Delta', table: 'delta'}
]

const COL_CATALOG: Array<{name: string; col: string; type: SqlType}> = [
  {name: 'title', col: 'title', type: 'text'},
  {name: 'count', col: 'count', type: 'integer'},
  {name: 'active', col: 'active', type: 'boolean'},
  {name: 'price', col: 'price', type: 'numeric'},
  {name: 'data', col: 'data', type: 'jsonb'},
  {name: 'ref', col: 'ref', type: 'uuid'},
  {name: 'at', col: 'at', type: 'timestamptz'}
]

// Type changes only WITHIN a group — Postgres auto-casts these in `ALTER COLUMN
// … TYPE` without a `USING` clause. Cross-group casts (e.g. integer→boolean)
// legitimately require a human-authored `USING` and are out of the fuzzer's scope
// (a separate product concern: the diff emits the ALTER but can't infer USING).
const CAST_GROUPS: SqlType[][] = [
  ['text', 'varchar'],
  ['integer', 'bigint', 'numeric']
]

// Mutable working model: entity name -> its non-id scalar/relation columns.
interface WorkCol {
  name: string
  col: string
  type: SqlType
  nullable: boolean
  unique: boolean
}
interface WorkFk {
  name: string // relation field name
  fkField: string // scalar field name holding the id
  fkCol: string // scalar column name
  target: string // target entity name
}
interface WorkEntity {
  name: string
  table: string
  cols: WorkCol[]
  fks: WorkFk[]
  indexes: IndexSpec[]
}

function toEntity(w: WorkEntity): Entity {
  const fields: Field[] = []
  for (const c of w.cols)
    fields.push(scalarField(c.name, c.col, c.type, {nullable: c.nullable, unique: c.unique}))
  for (const fk of w.fks) {
    // FK needs a nullable scalar column + a belongsTo relation resolving to it.
    fields.push(scalarField(fk.fkField, fk.fkCol, 'bigint', {nullable: true}))
    fields.push(belongsToField(fk.name, fk.fkField, fk.target, 'set null'))
  }
  return entity(w.name, w.table, fields, w.indexes)
}

function toStateSnapshot(model: Map<string, WorkEntity>): Snapshot {
  return snap([...model.values()].map(toEntity))
}

/**
 * Generate a deterministic sequence of `stepCount` model states by random
 * mutation. Returns walk steps ready for `runRoundTrip`. Rename mutations carry
 * the matching hint so the diff stays data-preserving (and exercises the rename
 * paths rather than drop+add).
 */
export function randomWalk(seed: number, stepCount: number): WalkStep[] {
  const rng = makeRng(seed)
  const model = new Map<string, WorkEntity>()
  const steps: WalkStep[] = []

  const liveNames = (): string[] => [...model.keys()]

  const addIndexName = (table: string, cols: string[], unique: boolean): string =>
    `${table}_${cols.join('_')}_${unique ? 'key' : 'idx'}`

  for (let i = 0; i < stepCount; i++) {
    let renames: Rename[] | undefined
    let tableRenames: TableRename[] | undefined
    let label = `step${i}`

    // Weight the operation menu toward whatever's currently possible.
    const names = liveNames()
    const ops: string[] = ['addTable']
    if (names.length > 0) {
      ops.push('addColumn', 'dropColumn', 'alterColumn', 'renameColumn', 'addIndex', 'dropIndex')
      ops.push('renameTable')
    }
    if (names.length > 1) ops.push('addFk', 'dropFk', 'dropTable')

    const op = rng.pick(ops)
    switch (op) {
      case 'addTable': {
        const free = ENTITY_POOL.filter(e => !model.has(e.name))
        if (!free.length) break
        const e = rng.pick(free)
        const n = rng.int(3)
        const cols: WorkCol[] = []
        const catalog = [...COL_CATALOG]
        for (let k = 0; k < n && catalog.length; k++) {
          const c = catalog.splice(rng.int(catalog.length), 1)[0]
          cols.push({...c, nullable: rng.bool(), unique: false})
        }
        model.set(e.name, {name: e.name, table: e.table, cols, fks: [], indexes: []})
        label = `add_${e.table}`
        break
      }
      case 'dropTable': {
        const victim = rng.pick(names)
        // Don't drop a table another entity still FKs into (keeps state valid).
        const referenced = [...model.values()].some(
          w => w.name !== victim && w.fks.some(fk => fk.target === victim)
        )
        if (referenced) break
        model.delete(victim)
        label = `drop_${victim}`
        break
      }
      case 'addColumn': {
        const w = model.get(rng.pick(names))!
        const used = new Set(w.cols.map(c => c.col))
        const free = COL_CATALOG.filter(c => !used.has(c.col))
        if (!free.length) break
        const c = rng.pick(free)
        w.cols.push({...c, nullable: rng.bool(), unique: false})
        label = `addcol_${w.table}_${c.col}`
        break
      }
      case 'dropColumn': {
        const w = model.get(rng.pick(names))!
        if (!w.cols.length) break
        const idx = rng.int(w.cols.length)
        const [removed] = w.cols.splice(idx, 1)
        // Drop any index that referenced it.
        w.indexes = w.indexes.filter(ix => !ix.columns.includes(removed.col))
        label = `dropcol_${w.table}_${removed.col}`
        break
      }
      case 'alterColumn': {
        const w = model.get(rng.pick(names))!
        if (!w.cols.length) break
        const c = w.cols[rng.int(w.cols.length)]
        const group = CAST_GROUPS.find(g => g.includes(c.type))
        // type-change is only offered when the column's type has castable siblings
        const kind = rng.pick(group ? [0, 1, 2] : [0, 1])
        if (kind === 0) c.nullable = !c.nullable
        else if (kind === 1) c.unique = !c.unique
        else c.type = rng.pick(group!.filter(t => t !== c.type))
        label = `alter_${w.table}_${c.col}`
        break
      }
      case 'renameColumn': {
        const w = model.get(rng.pick(names))!
        if (!w.cols.length) break
        const c = w.cols[rng.int(w.cols.length)]
        const newCol = `${c.col}_r${i}`
        // Indexes referencing the old column would drift; drop them for simplicity.
        w.indexes = w.indexes.filter(ix => !ix.columns.includes(c.col))
        renames = [{table: w.table, from: c.col, to: newCol}]
        c.name = `${c.name}R${i}`
        c.col = newCol
        label = `rencol_${w.table}`
        break
      }
      case 'renameTable': {
        const oldName = rng.pick(names)
        const w = model.get(oldName)!
        const free = ENTITY_POOL.filter(e => !model.has(e.name))
        if (!free.length) break
        const dest = rng.pick(free)
        // Move the entity to the new name/table; carry indexes' table over.
        model.delete(oldName)
        const moved: WorkEntity = {
          ...w,
          name: dest.name,
          table: dest.table,
          indexes: w.indexes.map(ix => ({...ix, table: dest.table, name: ix.name.replace(w.table, dest.table)}))
        }
        model.set(dest.name, moved)
        // Re-point any FK targeting the old entity name.
        for (const e of model.values())
          for (const fk of e.fks) if (fk.target === oldName) fk.target = dest.name
        tableRenames = [{from: oldName, to: dest.name}]
        label = `rentab_${w.table}_to_${dest.table}`
        break
      }
      case 'addIndex': {
        const w = model.get(rng.pick(names))!
        if (!w.cols.length) break
        // Non-unique single-column, OR unique COMPOSITE (≥2 cols). A single-column
        // UNIQUE index would collide with the column-level `unique` constraint name
        // (`<table>_<col>_key`) — real IR expresses single-column uniqueness via the
        // column flag, not a duplicate index — so the fuzzer keeps them disjoint.
        let cols: string[]
        let unique: boolean
        if (w.cols.length >= 2 && rng.bool()) {
          const a = w.cols[rng.int(w.cols.length)].col
          const b = w.cols[rng.int(w.cols.length)].col
          if (a === b) break
          cols = [a, b]
          unique = true
        } else {
          cols = [w.cols[rng.int(w.cols.length)].col]
          unique = false
        }
        const name = addIndexName(w.table, cols, unique)
        if (w.indexes.some(ix => ix.name === name)) break
        w.indexes.push({name, table: w.table, columns: cols, unique})
        label = `addidx_${w.table}`
        break
      }
      case 'dropIndex': {
        const w = model.get(rng.pick(names))!
        if (!w.indexes.length) break
        w.indexes.splice(rng.int(w.indexes.length), 1)
        label = `dropidx_${w.table}`
        break
      }
      case 'addFk': {
        const w = model.get(rng.pick(names))!
        const targets = names.filter(n => n !== w.name)
        if (!targets.length) break
        const target = rng.pick(targets)
        const fkField = `owner${i}`
        const fkCol = `owner_${i}`
        if (w.fks.some(fk => fk.fkCol === fkCol)) break
        w.fks.push({name: `owner${i}Rel`, fkField, fkCol, target})
        label = `addfk_${w.table}`
        break
      }
      case 'dropFk': {
        const withFk = [...model.values()].filter(w => w.fks.length)
        if (!withFk.length) break
        const w = rng.pick(withFk)
        w.fks.splice(rng.int(w.fks.length), 1)
        label = `dropfk_${w.table}`
        break
      }
    }

    steps.push({state: toStateSnapshot(model), renames, tableRenames, label})
  }

  return steps
}
