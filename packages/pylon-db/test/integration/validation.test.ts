import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  Model,
  connect,
  Database,
  getModelDefinitionOrThrow,
  id,
  int,
  manager,
  model,
  setDefaultDatabase,
  syncSchema,
  text,
  ValidationError
} from '../../src/index'

@model({table: 'val_widget'})
class ValWidget extends Model {
  static objects = manager(ValWidget)
  id = id()
  email = text({email: true})
  age = int({min: 0, max: 130})
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('validation on writes (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('val_widget').ifExists().cascade().execute()
    await syncSchema([getModelDefinitionOrThrow(ValWidget)])
  })
  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('val_widget').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('rejects invalid input with ValidationError before hitting the DB', async () => {
    await expect(ValWidget.objects.create({email: 'nope', age: -5})).rejects.toBeInstanceOf(
      ValidationError
    )
    // nothing was written
    expect(await ValWidget.objects.count()).toBe(0)
  })

  it('persists valid input', async () => {
    const w = await ValWidget.objects.create({email: 'a@b.co', age: 20})
    expect(w.id).toBeTypeOf('number')
    expect(await ValWidget.objects.count()).toBe(1)
  })
})
