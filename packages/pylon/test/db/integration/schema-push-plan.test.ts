/**
 * `pushPlan` — the READ-ONLY detection `db push` shows the operator before any destructive change:
 * orphan columns on model-owned tables (drop candidates) and the likely RENAMEs among them (reusing
 * the same `renameCandidates` heuristic as `migrate`). It mutates nothing; the CLI turns the confirmed
 * subset into a `syncSchema({renames, dropColumns})` call.
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
  pushPlan,
  setDefaultDatabase,
  text
} from '@/db/index'

class PpDoc extends Model {
  static config = {table: 'pp_doc'} satisfies ModelConfig<PpDoc>
  static objects = manager(PpDoc)
  id = id()
  fullName = text({nullable: true}) // the DB has `name` of the same type → a rename candidate
  keep = text({nullable: true})
}
new Pylon({db: {models: [PpDoc]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('pushPlan (destructive-drift detection)', () => {
  let db: Database
  let plan: Awaited<ReturnType<typeof pushPlan>>

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('pp_doc').ifExists().cascade().execute()
    // `name` (orphan, text) pairs with the model's `full_name` (text) → rename candidate.
    // `junk` (orphan, text) has no counterpart → a pure drop candidate.
    await sql`CREATE TABLE pp_doc (id bigserial PRIMARY KEY, name text, keep text, junk text NOT NULL)`.execute(
      db.kysely
    )
    await sql`INSERT INTO pp_doc (name, keep, junk) VALUES ('Ada', 'k', 'j')`.execute(db.kysely)
    plan = await pushPlan(db)
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('pp_doc').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('detects a rename candidate (a same-type drop + add on one table)', () => {
    expect(plan.renameCandidates).toContainEqual({table: 'pp_doc', from: 'name', to: 'full_name'})
  })

  it('lists every orphan column as a drop candidate', () => {
    expect(plan.dropColumns).toContainEqual({table: 'pp_doc', column: 'name'})
    expect(plan.dropColumns).toContainEqual({table: 'pp_doc', column: 'junk'})
  })

  it('does not flag a column the model still has', () => {
    expect(plan.dropColumns.find(d => d.column === 'keep')).toBeUndefined()
  })

  it('is read-only — detection mutates nothing', async () => {
    const cols = (await introspectPhysical(db)).pp_doc.columns.map(c => c.name).sort()
    expect(cols).toEqual(['id', 'junk', 'keep', 'name']) // untouched: name + junk still there
  })
})
