/**
 * Regression: a many-to-many between two long-named tables produces a join-table
 * name + two FK constraint names that exceed Postgres's 63-char identifier limit.
 * Without clamping, Postgres silently truncates both FK names to the same 63
 * chars → "constraint already exists" collision on create. `pgIdent` truncates
 * with a hash suffix so each stays ≤63 and distinct.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {joinTableName, pgIdent} from '@getcronit/pylon-ir'
import {
  connect,
  Database,
  id,
  manager,
  manyToMany,
  Model,
  model,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'

// ~49 chars each → sorted join name ~99 chars (well over 63).
const A_TABLE = 'tbl_org_membership_invitation_audit_records_alpha'
const O_TABLE = 'tbl_org_membership_invitation_audit_records_omega'

@model({table: A_TABLE})
class LongAlpha extends Model {
  static objects = manager(LongAlpha)
  id = id()
  name = text()
  omegas = manyToMany(() => LongOmega)
}

@model({table: O_TABLE})
class LongOmega extends Model {
  static objects = manager(LongOmega)
  id = id()
  name = text()
  alphas = manyToMany(() => LongAlpha)
}

const JOIN = joinTableName(A_TABLE, O_TABLE)
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('pgIdent (unit)', () => {
  it('clamps to ≤63 chars, leaves short names untouched, and stays deterministic', () => {
    expect(pgIdent('short_name')).toBe('short_name')
    const long = 'x'.repeat(100)
    expect(pgIdent(long).length).toBe(63)
    expect(pgIdent(long)).toBe(pgIdent(long)) // deterministic
    // two distinct long names don't collide after truncation
    expect(pgIdent('a'.repeat(80) + '_alpha')).not.toBe(pgIdent('a'.repeat(80) + '_omega'))
  })
})

describe.skipIf(!runDb)('m2m with long table names (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of [JOIN, A_TABLE, O_TABLE]) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema() // would throw on the FK-name collision if unclamped
  })
  afterAll(async () => {
    if (db) {
      for (const t of [JOIN, A_TABLE, O_TABLE]) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('the join table name is clamped to ≤63 chars', () => {
    expect(JOIN.length).toBeLessThanOrEqual(63)
    expect(A_TABLE.length + 1 + O_TABLE.length).toBeGreaterThan(63) // the raw name really did overflow
  })

  it('creates TWO distinct FK constraints on the join table (no collision)', async () => {
    const rows = await db.kysely
      .selectFrom('information_schema.table_constraints' as any)
      .select(['constraint_name'] as any)
      .where('table_name' as any, '=', JOIN)
      .where('constraint_type' as any, '=', 'FOREIGN KEY')
      .execute()
    expect(rows.length).toBe(2)
    expect(new Set(rows.map((r: any) => r.constraint_name)).size).toBe(2) // distinct
    for (const r of rows as any[]) expect(r.constraint_name.length).toBeLessThanOrEqual(63)
  })

  it('round-trips links through the truncated join table (both sides)', async () => {
    const a = await LongAlpha.objects.create({name: 'a'})
    const o = await LongOmega.objects.create({name: 'o'})
    await a.omegas.add(o)
    expect((await a.omegas.all()).map(x => x.name)).toEqual(['o'])
    expect((await o.alphas.all()).map(x => x.name)).toEqual(['a']) // reverse side agrees
  })
})
