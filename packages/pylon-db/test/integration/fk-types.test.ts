/**
 * Foreign-key column types follow the TARGET's primary key. A cuid `text` PK or
 * a `uuid` PK must yield a `text`/`uuid` FK column — not the `bigint` default —
 * or the FK constraint (and any insert) fails. Regression for the lokalis case
 * where almost every model has a text/uuid PK.
 */
import {physicalSchemaOf} from '@getcronit/pylon-ir'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  createId,
  Database,
  foreignKey,
  id,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text,
  toIR,
  uuid,
  type Relation
} from '../../src/index'

class FktOrg extends Model {
  static config = {table: 'fkt_org'} satisfies ModelConfig<FktOrg>
  static objects = manager(FktOrg)
  id = text({primaryKey: true, default: createId}) // cuid-style text PK
  name = text()
}
new Pylon({db: {models: [FktOrg]}})

class FktLocation extends Model {
  static config = {table: 'fkt_location'} satisfies ModelConfig<FktLocation>
  static objects = manager(FktLocation)
  id = uuid({primaryKey: true}) // uuid PK
  label = text()
}
new Pylon({db: {models: [FktLocation]}})

class FktDoc extends Model {
  static config = {table: 'fkt_doc'} satisfies ModelConfig<FktDoc>
  static objects = manager(FktDoc)
  id = id() // bigint PK
  title = text()
  orgId = foreignKey(() => FktOrg) // → should be text
  declare org: Relation<FktOrg>
  locationId = foreignKey(() => FktLocation, {nullable: true}) // → should be uuid
  declare location: Relation<FktLocation>
}
new Pylon({db: {models: [FktDoc]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT
const TABLES = ['fkt_doc', 'fkt_location', 'fkt_org']

describe('FK column type follows the target PK (IR, unit)', () => {
  it('infers text / uuid / bigint FK column types from the target', () => {
    const schema = physicalSchemaOf(toIR().entities)
    const cols = Object.fromEntries(
      schema.FktDoc.columns.map(c => [c.name, c.sqlType])
    )
    expect(cols.org_id).toBe('text') // FktOrg.id is text
    expect(cols.location_id).toBe('uuid') // FktLocation.id is uuid
    expect(cols.id).toBe('bigint') // own PK
  })
})

describe.skipIf(!runDb)('FK column type follows the target PK (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of TABLES) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
  })
  afterAll(async () => {
    if (db) {
      for (const t of TABLES) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('creates FK columns matching the referenced PK type', async () => {
    const cols = await db.kysely.introspection.getTables()
    const doc = cols.find(t => t.name === 'fkt_doc')!
    const by = Object.fromEntries(doc.columns.map(c => [c.name, c.dataType]))
    expect(by.org_id).toBe('text')
    expect(by.location_id).toBe('uuid')
  })

  it('the FK constraint holds — a related insert round-trips', async () => {
    const org = await FktOrg.objects.create({name: 'Acme'})
    expect(org.id).toMatch(/^[a-z]/) // generated cuid-style id
    const doc = await FktDoc.objects.create({title: 'Spec', orgId: org.id})
    const loaded = await doc.org
    expect(loaded?.name).toBe('Acme')
  })
})
