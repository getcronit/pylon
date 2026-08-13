/**
 * `useDatabase({debug})` ORM tracing: when `debug` is bound on the app context,
 * every query logs its SQL, the tenant scoping applied, and the row-level policy
 * decision. Off by default — completely silent.
 */
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  id,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'
import {runWithAppContext} from '../../src/app-context'

class Item extends Model {
  static config = {table: 'dbg_item', tenant: 'orgId'} satisfies ModelConfig<Item>
  static objects = manager(Item)
  id = id()
  name = text()
  orgId = text() // tenant column, stamped from the bound tenant on create
}
new Pylon({db: {models: [Item]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('useDatabase debug tracing (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('dbg_item').ifExists().cascade().execute()
    await syncSchema()
    await runWithAppContext({tenant: 'o1'}, () => Item.objects.create({name: 'a'}))
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('dbg_item').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  const capture = async (ctx: Record<string, unknown>) => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runWithAppContext(ctx as any, () => Item.objects.all())
    const lines = spy.mock.calls.map(c => String(c[0]))
    spy.mockRestore()
    return lines
  }

  it('logs tenant + policy + query when debug is on', async () => {
    const lines = await capture({tenant: 'o1', debug: true})
    expect(lines.some(l => l.includes('[pylon-db:tenant]'))).toBe(true)
    expect(lines.some(l => l.includes('[pylon-db:policy]'))).toBe(true)
    expect(lines.some(l => l.includes('[pylon-db:query]'))).toBe(true)
  })

  it('is completely silent when debug is off', async () => {
    const lines = await capture({tenant: 'o1'})
    expect(lines.some(l => l.includes('[pylon-db:'))).toBe(false)
  })
})
