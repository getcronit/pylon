import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  Model,
  connect,
  Database,
  getModelDefinitionOrThrow,
  id,
  int,
  manager,
  setDefaultDatabase,
  syncSchema,
  text,
  ValidationError
} from '@/db/index'

class ValWidget extends Model {
  static config = {table: 'val_widget'} satisfies ModelConfig<ValWidget>
  static objects = manager(ValWidget)
  id = id()
  email = text({email: true})
  age = int({min: 0, max: 130})
}
new Pylon({db: {models: [ValWidget]}})

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

  it('the DB CHECK (dual projection) rejects a RAW write that bypasses the ORM validator', async () => {
    // `age = int({min: 0, max: 130})` is projected to a CHECK on the table, so a
    // direct INSERT that never runs validateInstance is still rejected by Postgres.
    await expect(
      db.kysely
        .insertInto('val_widget' as never)
        .values({email: 'raw@b.co', age: -5} as never)
        .execute()
    ).rejects.toThrow(/check constraint|val_widget_age_check/i)
  })
})
