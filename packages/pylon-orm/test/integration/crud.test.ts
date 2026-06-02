import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  Model,
  boolean,
  connect,
  Database,
  id,
  model,
  setDefaultDatabase,
  syncSchema,
  text,
  timestamp
} from '../../src/index'

@model()
class User extends Model {
  id = id()
  email = text({unique: true})
  name = text()
  isActive = boolean({default: true})
  createdAt = timestamp({defaultSql: 'now()'})
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'

// Skip entirely unless a database is available (CI / `docker compose up`).
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('Active Record CRUD (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('user').ifExists().cascade().execute()
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('user').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('creates a row and backfills the generated id', async () => {
    const user = await User.create({email: 'a@example.com', name: 'Ada'})
    expect(user.id).toBeTypeOf('number')
    expect(user.isActive).toBe(true) // server default returned
    expect(user.createdAt).toBeInstanceOf(Date)
  })

  it('queries with filter/get/all', async () => {
    await User.create({email: 'b@example.com', name: 'Babbage'})

    const all = await User.all()
    expect(all.length).toBeGreaterThanOrEqual(2)

    const ada = await User.get({email: 'a@example.com'})
    expect(ada.name).toBe('Ada')

    const actives = await User.filter({isActive: true}).all()
    expect(actives.every(u => u.isActive)).toBe(true)
  })

  it('orders and limits', async () => {
    const first = await User.orderBy('email').limit(1).all()
    expect(first[0].email).toBe('a@example.com')

    const lastDesc = await User.orderBy('-email').first()
    expect(lastDesc?.email).toBe('b@example.com')
  })

  it('updates an existing instance (no duplicate insert)', async () => {
    const ada = await User.get({email: 'a@example.com'})
    ada.name = 'Ada Lovelace'
    await ada.save()

    const reloaded = await User.get({email: 'a@example.com'})
    expect(reloaded.name).toBe('Ada Lovelace')
    expect(await User.filter({email: 'a@example.com'}).count()).toBe(1)
  })

  it('deletes an instance', async () => {
    const babbage = await User.get({email: 'b@example.com'})
    await babbage.delete()
    expect(await User.filter({email: 'b@example.com'}).count()).toBe(0)
  })
})
