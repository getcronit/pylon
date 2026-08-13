import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  boolean,
  connect,
  Database,
  id,
  manager,
  setDefaultDatabase,
  syncSchema,
  text,
  timestamp
} from '../../src/index'

class User extends Model {
  static objects = manager(User)
  id = id()
  email = text({unique: true})
  name = text()
  isActive = boolean({default: true})
  createdAt = timestamp({defaultSql: 'now()'})
}
new Pylon({db: {models: [User]}})

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
    const user = await User.objects.create({email: 'a@example.com', name: 'Ada'})
    expect(user.id).toBeTypeOf('number')
    expect(user.isActive).toBe(true) // server default returned
    expect(user.createdAt).toBeInstanceOf(Date)
  })

  it('queries with filter/get/all', async () => {
    await User.objects.create({email: 'b@example.com', name: 'Babbage'})

    const all = await User.objects.all()
    expect(all.length).toBeGreaterThanOrEqual(2)

    const ada = await User.objects.get({email: 'a@example.com'})
    expect(ada.name).toBe('Ada')

    const actives = await User.objects.filter({isActive: true}).all()
    expect(actives.every(u => u.isActive)).toBe(true)
  })

  it('orders and limits', async () => {
    const first = await User.objects.orderBy('email').limit(1).all()
    expect(first[0].email).toBe('a@example.com')

    const lastDesc = await User.objects.orderBy('-email').first()
    expect(lastDesc?.email).toBe('b@example.com')
  })

  it('updates an existing instance (no duplicate insert)', async () => {
    const ada = await User.objects.get({email: 'a@example.com'})
    ada.name = 'Ada Lovelace'
    await ada.$save()

    const reloaded = await User.objects.get({email: 'a@example.com'})
    expect(reloaded.name).toBe('Ada Lovelace')
    expect(await User.objects.filter({email: 'a@example.com'}).count()).toBe(1)
  })

  it('deletes an instance', async () => {
    const babbage = await User.objects.get({email: 'b@example.com'})
    await babbage.$delete()
    expect(await User.objects.filter({email: 'b@example.com'}).count()).toBe(0)
  })
})
