/**
 * numeric(precision, scale) → `numeric(p, s)` DDL, and `updatedAt()` (Prisma's
 * `@updatedAt`) auto-stamped on every write.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  Database,
  id,
  manager,
  Model,
  model,
  numeric,
  setDefaultDatabase,
  syncSchema,
  text,
  timestamp,
  updatedAt
} from '../../src/index'

@model({table: 'num_inv'})
class NumInv extends Model {
  static objects = manager(NumInv)
  id = id()
  label = text()
  total = numeric({precision: 12, scale: 2})
  taxRate = numeric({precision: 5, scale: 2, nullable: true})
  createdAt = timestamp({defaultSql: 'now()'})
  updatedAt = updatedAt()
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('numeric(p,s) + updatedAt (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('num_inv').ifExists().cascade().execute()
    await syncSchema()
  })
  afterAll(async () => {
    if (db) await db.kysely.schema.dropTable('num_inv').ifExists().cascade().execute()
    if (db) await db.destroy()
    setDefaultDatabase(undefined)
  })

  it('creates numeric columns with the declared precision/scale', async () => {
    const cols = await db.kysely.introspection.getTables()
    const t = cols.find(x => x.name === 'num_inv')!
    const total = t.columns.find(c => c.name === 'total')!
    // pg reports the type as numeric; precision/scale live in the type modifier.
    expect(total.dataType).toBe('numeric')
    const row = await db.kysely
      .selectFrom('information_schema.columns' as any)
      .select(['numeric_precision', 'numeric_scale'] as any)
      .where('table_name' as any, '=', 'num_inv')
      .where('column_name' as any, '=', 'total')
      .executeTakeFirstOrThrow()
    expect(Number((row as any).numeric_precision)).toBe(12)
    expect(Number((row as any).numeric_scale)).toBe(2)
  })

  it('rounds/stores decimals at the declared scale', async () => {
    const inv = await NumInv.objects.create({label: 'a', total: 19.99})
    const reloaded = await NumInv.objects.get({id: inv.id})
    expect(Number(reloaded.total)).toBeCloseTo(19.99, 2)
  })

  it('updatedAt is set on create and bumped on every update', async () => {
    const inv = await NumInv.objects.create({label: 'b', total: 1})
    const first = new Date((inv as any).updatedAt).getTime()
    expect(first).toBeGreaterThan(0)

    await new Promise(r => setTimeout(r, 20))
    ;(inv as any).label = 'b2'
    await (inv as any).$save()
    const second = new Date((inv as any).updatedAt).getTime()
    expect(second).toBeGreaterThan(first)
  })
})
