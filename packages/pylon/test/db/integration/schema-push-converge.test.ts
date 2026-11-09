/**
 * `db push` convergence (Stage 1, additive). `syncSchema` must bring an EXISTING table up to its
 * model — ADD every missing column (including a new FK column, BEFORE its constraint), relax a
 * NOT-NULL add on a non-empty table instead of failing, and report (non-destructively) columns the
 * model dropped. Before this, `createTable().ifNotExists()` was a no-op on a table that already
 * existed, so a newly-added model field silently never got its column (push said "ok", then queries
 * failed `column "x" does not exist`).
 */
import {sql} from 'kysely'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  foreignKey,
  id,
  introspectPhysical,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text
} from '@/db/index'

class CvOrg extends Model {
  static config = {table: 'cv_org'} satisfies ModelConfig<CvOrg>
  static objects = manager(CvOrg)
  id = id()
  name = text()
}
new Pylon({db: {models: [CvOrg]}})

class CvUser extends Model {
  static config = {table: 'cv_user'} satisfies ModelConfig<CvUser>
  static objects = manager(CvUser)
  id = id()
  email = text({unique: true})
  nickname = text({nullable: true}) // plain nullable add
  bio = text({default: ''}) // NOT NULL WITH a default → safe add even on a non-empty table
  role = text() // NOT NULL, NO default → must be relaxed to nullable on a non-empty table
  orgId = foreignKey(() => CvOrg, {nullable: true}) // a new FK column + its constraint
}
new Pylon({db: {models: [CvUser]}})

class CvLegacy extends Model {
  static config = {table: 'cv_legacy'} satisfies ModelConfig<CvLegacy>
  static objects = manager(CvLegacy)
  id = id()
  keep = text({nullable: true})
}
new Pylon({db: {models: [CvLegacy]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

const byName = (t: {columns: {name: string}[]}) =>
  Object.fromEntries(t.columns.map(c => [c.name, c]))

describe.skipIf(!runDb)('db push convergence (additive)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['cv_user', 'cv_legacy', 'cv_org']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    // An OLDER cv_user: only id + email. The new model fields (nickname/bio/role/org_id) are missing,
    // and the table is NON-EMPTY — so a naive NOT-NULL add would fail.
    await sql`CREATE TABLE cv_user (id bigserial PRIMARY KEY, email text NOT NULL UNIQUE)`.execute(
      db.kysely
    )
    await sql`INSERT INTO cv_user (email) VALUES ('a@example.com')`.execute(db.kysely)
    // A drifted cv_legacy: a NOT-NULL `dropped` column the model no longer defines (+ a row).
    await sql`CREATE TABLE cv_legacy (id bigserial PRIMARY KEY, keep text, dropped text NOT NULL)`.execute(
      db.kysely
    )
    await sql`INSERT INTO cv_legacy (keep, dropped) VALUES ('k', 'd')`.execute(db.kysely)

    // Creates cv_org whole, converges cv_user, reports/relaxes cv_legacy.
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      for (const t of ['cv_user', 'cv_legacy', 'cv_org']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('adds every model column the existing table lacked', async () => {
    const cols = byName((await introspectPhysical(db)).cv_user)
    expect(cols.nickname).toBeDefined()
    expect(cols.bio).toBeDefined()
    expect(cols.role).toBeDefined()
    expect(cols.org_id).toBeDefined()
    expect(cols.nickname).toMatchObject({nullable: true})
    expect(cols.bio).toMatchObject({nullable: false}) // NOT NULL preserved — it had a default
  })

  it('relaxes a NOT NULL column (no default) added to a non-empty table', async () => {
    const cols = byName((await introspectPhysical(db)).cv_user)
    // Without the relax, ADD COLUMN role text NOT NULL would have thrown on the pre-inserted row.
    expect(cols.role).toMatchObject({nullable: true})
  })

  it('preserves existing rows (no table recreate / data loss)', async () => {
    const {rows} = await sql<{n: string}>`SELECT count(*)::text AS n FROM cv_user`.execute(db.kysely)
    expect(rows[0].n).toBe('1')
  })

  it('adds a new FK column BEFORE its constraint (ADD CONSTRAINT would fail otherwise)', async () => {
    const fk = (await introspectPhysical(db)).cv_user.foreignKeys?.find(f => f.column === 'org_id')
    expect(fk).toMatchObject({refTable: 'cv_org', refColumn: 'id'})
  })

  it('reports an orphan column non-destructively — kept, and its NOT NULL relaxed', async () => {
    const cols = byName((await introspectPhysical(db)).cv_legacy)
    expect(cols.dropped).toBeDefined() // NOT dropped
    expect(cols.dropped).toMatchObject({nullable: true}) // relaxed so it can't block inserts
    const {rows} = await sql<{n: string}>`SELECT count(*)::text AS n FROM cv_legacy`.execute(db.kysely)
    expect(rows[0].n).toBe('1') // data preserved
  })

  it('is idempotent — a second push neither errors nor changes the converged schema', async () => {
    await expect(syncSchema()).resolves.toBeUndefined()
    const cols = byName((await introspectPhysical(db)).cv_user)
    expect(Object.keys(cols).sort()).toEqual(['bio', 'email', 'id', 'nickname', 'org_id', 'role'])
  })
})
