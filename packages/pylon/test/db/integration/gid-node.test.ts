/**
 * `resolveNode` — the runtime behind a Relay `node(gid)` refetch field: dispatch
 * a global id to its owning model, look the row up by PK, tag `__typename`.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  manager,
  Model,
  resolveNode,
  setDefaultDatabase,
  snowflake,
  syncSchema,
  text,
  toGid
} from '../../src/index'

class GidWidget extends Model {
  static config = {table: 'gid_widget'} satisfies ModelConfig<GidWidget>
  static objects = manager(GidWidget)
  id = text({primaryKey: true, default: snowflake({nodeId: 200})})
  label = text()
}
new Pylon({db: {models: [GidWidget]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('resolveNode (error paths, no DB)', () => {
  it('throws on a malformed gid', async () => {
    await expect(resolveNode('not-a-gid')).rejects.toThrow(/Malformed/)
  })
  it('throws on an unknown type', async () => {
    await expect(resolveNode('gid://pylon/NoSuchType/1')).rejects.toThrow(
      /Unknown type in global id: NoSuchType/
    )
  })
})

describe.skipIf(!runDb)('resolveNode (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('gid_widget').ifExists().cascade().execute()
    await syncSchema()
  })
  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('gid_widget').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('resolves a gid to the row, tagged with __typename', async () => {
    const w = await GidWidget.objects.create({label: 'hello'})
    const node = await resolveNode(toGid('GidWidget', w.id))
    expect(node).not.toBeNull()
    expect(node!.__typename).toBe('GidWidget')
    expect(node!.id).toBe(w.id)
    expect(node!.label).toBe('hello')
  })

  it('returns null for a well-formed gid whose row is absent (Relay semantics)', async () => {
    const node = await resolveNode(toGid('GidWidget', '999999999999999'))
    expect(node).toBeNull()
  })
})
