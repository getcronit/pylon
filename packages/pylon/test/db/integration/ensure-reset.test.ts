/**
 * `ensureDatabase` (dev create-if-missing, Prisma parity) and `resetSchema`
 * (the drop step behind `pylon db reset`) against a real Postgres.
 */
import {Client} from 'pg'
import {sql} from 'kysely'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  Database,
  ensureDatabase,
  resetSchema,
  setDefaultDatabase
} from '@/db/index'

const base =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

const withDbName = (name: string): string => {
  const u = new URL(base)
  u.pathname = `/${name}`
  return u.toString()
}

const tableExists = async (db: Database, name: string): Promise<boolean> => {
  const res = await sql<{present: boolean}>`
    select to_regclass(${`public.${name}`}) is not null as present
  `.execute(db.kysely)
  return res.rows[0]!.present
}

describe.skipIf(!runDb)('ensureDatabase + resetSchema (Postgres)', () => {
  it('is a no-op when the target database already exists', async () => {
    const name = new URL(base).pathname.slice(1)
    expect(await ensureDatabase(base)).toEqual({created: false, database: name})
  })

  it('creates a missing database, idempotently, and it is then connectable', async () => {
    const name = `pylon_ensure_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const cs = withDbName(name)
    try {
      expect(await ensureDatabase(cs)).toEqual({created: true, database: name})
      // Second call now finds it → no-op (created: false).
      expect(await ensureDatabase(cs)).toEqual({created: false, database: name})
      // It is a real, connectable database.
      const c = new Client({connectionString: cs})
      await c.connect()
      await c.end()
    } finally {
      const admin = new Client({connectionString: withDbName('postgres')})
      await admin.connect()
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    }
  })

  it('rethrows a non-"missing database" failure untouched (bad password)', async () => {
    const u = new URL(base)
    u.password = 'definitely-wrong-password'
    // Auth failure (28P01) is not ours to fix — it must surface, not be swallowed
    // into a create attempt.
    await expect(ensureDatabase(u.toString())).rejects.toThrow(/password|authentication/i)
  })

  describe('resetSchema', () => {
    let database: Database
    beforeAll(() => {
      database = connect({connectionString: base})
    })
    afterAll(async () => {
      await database.destroy()
      setDefaultDatabase(undefined)
    })

    it('drops every table (orphans included) to a clean slate', async () => {
      await database.kysely.schema
        .createTable('reset_probe')
        .ifNotExists()
        .addColumn('id', 'integer')
        .execute()
      expect(await tableExists(database, 'reset_probe')).toBe(true)

      await resetSchema()

      // The whole schema was dropped + recreated: the table is gone, and the fresh
      // public schema is usable again.
      expect(await tableExists(database, 'reset_probe')).toBe(false)
      await database.kysely.schema
        .createTable('reset_probe2')
        .addColumn('id', 'integer')
        .execute()
      expect(await tableExists(database, 'reset_probe2')).toBe(true)
      await database.kysely.schema.dropTable('reset_probe2').ifExists().execute()
    })
  })
})
