import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  connect,
  Database,
  id,
  int,
  manager,
  models,
  setDefaultDatabase,
  syncSchema,
  text,
  type ModelConfig
} from '@/db/index'
import {runWithAppContext} from '@/db/app-context'

const {Vector} = models

// Plain model: conflict on a single unique column.
class Kv extends Model {
  static objects = manager(Kv)
  id = id()
  key = text({unique: true})
  value = text()
  hits = int({default: 0})
}

// SOCKEL-shaped: tenant-scoped, composite unique (tenant, ref, model), + a vector.
class Emb extends Model {
  static objects = manager(Emb)
  static config = {
    tenant: 'tenantId',
    indexes: [{columns: ['tenantId', 'objectRef', 'model'], unique: true}]
  } satisfies ModelConfig<Emb>
  id = id()
  tenantId = text({column: 'tenant_id'})
  objectRef = text({column: 'object_ref'})
  model = text()
  contentHash = text({column: 'content_hash'})
  embedding = Vector({dim: 3})
}
new Pylon({db: {models: [Kv, Emb]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('native upsert — INSERT … ON CONFLICT DO UPDATE (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('kv').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('emb').ifExists().cascade().execute()
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('kv').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('emb').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('inserts when the row is new', async () => {
    const row = await Kv.objects.upsert({key: 'a', value: '1'}, {onConflict: ['key'], update: ['value']})
    expect(row.value).toBe('1')
    expect(await Kv.objects.count()).toBe(1)
  })

  it('updates in place on conflict (same row, no duplicate)', async () => {
    const first = await Kv.objects.get({key: 'a'})
    const row = await Kv.objects.upsert({key: 'a', value: '2'}, {onConflict: ['key'], update: ['value']})
    expect(row.id).toBe(first.id) // same PK — updated, not re-inserted
    expect(row.value).toBe('2')
    expect(await Kv.objects.count()).toBe(1)
  })

  it('default update set = provided columns minus conflict target + PK', async () => {
    await Kv.objects.upsert({key: 'a', value: '9', hits: 7}, {onConflict: ['key']})
    const read = await Kv.objects.get({key: 'a'})
    expect(read.value).toBe('9')
    expect(read.hits).toBe(7)
  })

  it('upsertMany inserts new + updates conflicting in one statement', async () => {
    await Kv.objects.upsert({key: 'b', value: 'x'}, {onConflict: ['key'], update: ['value']})
    const rows = await Kv.objects.upsertMany(
      [
        {key: 'b', value: 'B'}, // conflicts → update
        {key: 'c', value: 'C'} // new → insert
      ],
      {onConflict: ['key'], update: ['value']}
    )
    expect(rows.map(r => r.value).sort()).toEqual(['B', 'C'])
    expect((await Kv.objects.get({key: 'b'})).value).toBe('B')
    expect((await Kv.objects.get({key: 'c'})).value).toBe('C')
  })

  it('re-embed loop: tenant-scoped upsert on the composite unique key', async () => {
    const opts = {
      onConflict: ['tenantId', 'objectRef', 'model'] as const,
      update: ['contentHash', 'embedding'] as const
    }
    // t1: first embed (insert) → re-embed (update in place)
    await runWithAppContext({tenant: 't1'}, async () => {
      await Emb.objects.upsert({objectRef: 'r1', model: 'm', contentHash: 'h1', embedding: [1, 0, 0]}, opts)
      await Emb.objects.upsert({objectRef: 'r1', model: 'm', contentHash: 'h2', embedding: [0, 1, 0]}, opts)
      const rows = await Emb.objects.all()
      expect(rows.length).toBe(1) // updated in place, not duplicated
      expect(rows[0].contentHash).toBe('h2')
    })
    // t2: same (objectRef, model) is a DIFFERENT row (tenant is in the unique key) —
    // the upsert must NOT clobber t1's row.
    await runWithAppContext({tenant: 't2'}, async () => {
      await Emb.objects.upsert({objectRef: 'r1', model: 'm', contentHash: 'h1-t2', embedding: [1, 0, 0]}, opts)
      const rows = await Emb.objects.all()
      expect(rows.length).toBe(1)
      expect(rows[0].contentHash).toBe('h1-t2')
    })
    // t1 still reads its own value — untouched by t2's upsert.
    await runWithAppContext({tenant: 't1'}, async () => {
      const t1 = await Emb.objects.get({objectRef: 'r1'})
      expect(t1.contentHash).toBe('h2')
    })
  })
})
