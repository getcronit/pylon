/**
 * `db push` destructive plan (Stage 2). The engine never INFERS data loss — the caller (CLI, from
 * interactive prompts or `--force`/`--rename` flags) hands `syncSchema` an explicit plan:
 *   - `renames`     → data-preserving `RENAME COLUMN` (a dropped column is really a new one)
 *   - `dropColumns` → surgical DROP of only the listed orphan columns (others are kept + relaxed)
 *   - `dropTables`  → explicit DROP of an orphan table (never from drift alone)
 * This is finer-grained than Prisma's all-or-nothing `--accept-data-loss` / `--force-reset`.
 */
import {sql} from 'kysely'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  id,
  introspectPhysical,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text
} from '@/db/index'

class S2Rename extends Model {
  static config = {table: 's2_rename'} satisfies ModelConfig<S2Rename>
  static objects = manager(S2Rename)
  id = id()
  fullName = text({nullable: true}) // the DB has `name`; we rename name → full_name
}
new Pylon({db: {models: [S2Rename]}})

class S2Drop extends Model {
  static config = {table: 's2_drop'} satisfies ModelConfig<S2Drop>
  static objects = manager(S2Drop)
  id = id()
  keep = text({nullable: true}) // the DB also has `junk` (dropped) and `note` (kept + relaxed)
}
new Pylon({db: {models: [S2Drop]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

const byName = (t: {columns: {name: string}[]}) =>
  Object.fromEntries(t.columns.map(c => [c.name, c]))

describe.skipIf(!runDb)('db push destructive plan (--force / --rename)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['s2_rename', 's2_drop', 's2_orphan_table']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    // Rename scenario: the live column is `name`, with data; the model calls it `full_name`.
    await sql`CREATE TABLE s2_rename (id bigserial PRIMARY KEY, name text)`.execute(db.kysely)
    await sql`INSERT INTO s2_rename (name) VALUES ('Ada')`.execute(db.kysely)
    // Surgical drop: two orphans — `junk` (to drop) and `note` (NOT listed → kept + relaxed).
    await sql`CREATE TABLE s2_drop (id bigserial PRIMARY KEY, keep text, junk text NOT NULL, note text NOT NULL)`.execute(
      db.kysely
    )
    await sql`INSERT INTO s2_drop (keep, junk, note) VALUES ('k', 'j', 'n')`.execute(db.kysely)
    // An orphan table (no model) — only dropped because it is listed explicitly.
    await sql`CREATE TABLE s2_orphan_table (id bigserial PRIMARY KEY, x text)`.execute(db.kysely)

    await syncSchema(undefined, {
      renames: [{table: 's2_rename', from: 'name', to: 'full_name'}],
      dropColumns: [{table: 's2_drop', column: 'junk'}],
      dropTables: ['s2_orphan_table']
    })
  })

  afterAll(async () => {
    if (db) {
      for (const t of ['s2_rename', 's2_drop', 's2_orphan_table']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('renames a column data-preservingly (not drop+add)', async () => {
    const cols = byName((await introspectPhysical(db)).s2_rename)
    expect(cols.full_name).toBeDefined()
    expect(cols.name).toBeUndefined()
    // The value rode along — a drop+add would have left it NULL/empty.
    const {rows} = await sql<{full_name: string}>`SELECT full_name FROM s2_rename`.execute(db.kysely)
    expect(rows[0].full_name).toBe('Ada')
  })

  it('drops ONLY the listed orphan column, keeping (and relaxing) the rest', async () => {
    const cols = byName((await introspectPhysical(db)).s2_drop)
    expect(cols.junk).toBeUndefined() // dropped (was listed)
    expect(cols.note).toBeDefined() // kept (was NOT listed)
    expect(cols.note).toMatchObject({nullable: true}) // relaxed so it can't block inserts
    // The surviving row is intact.
    const {rows} = await sql<{keep: string; note: string}>`SELECT keep, note FROM s2_drop`.execute(
      db.kysely
    )
    expect(rows[0]).toMatchObject({keep: 'k', note: 'n'})
  })

  it('drops an explicitly listed orphan table', async () => {
    expect((await introspectPhysical(db)).s2_orphan_table).toBeUndefined()
    const {rows} = await sql<{reg: string | null}>`SELECT to_regclass('s2_orphan_table') AS reg`.execute(
      db.kysely
    )
    expect(rows[0].reg).toBeNull()
  })

  it('a re-run with an already-applied rename is tolerated (no throw)', async () => {
    await expect(
      syncSchema(undefined, {renames: [{table: 's2_rename', from: 'name', to: 'full_name'}]})
    ).resolves.toBeUndefined()
    const cols = byName((await introspectPhysical(db)).s2_rename)
    expect(cols.full_name).toBeDefined() // still there, untouched
  })
})
