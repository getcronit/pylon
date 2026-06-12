import {afterAll, beforeAll, describe, expect, it} from 'vitest'
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

// Distinct table names so the suite never collides with other integration
// files that also register `post`/`tag` in the shared, process-global registry.
@model({table: 'm2m_post'})
class M2MPost extends Model {
  static objects = manager(M2MPost)
  id = id()
  title = text()
  tags = manyToMany(() => M2MTag)
}

@model({table: 'm2m_tag'})
class M2MTag extends Model {
  static objects = manager(M2MTag)
  id = id()
  label = text()
  posts = manyToMany(() => M2MPost)
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

const JOIN = 'm2m_post_m2m_tag'

describe.skipIf(!runDb)('Many-to-many (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable(JOIN).ifExists().cascade().execute()
    await db.kysely.schema.dropTable('m2m_post').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('m2m_tag').ifExists().cascade().execute()
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable(JOIN).ifExists().cascade().execute()
      await db.kysely.schema.dropTable('m2m_post').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('m2m_tag').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('synthesizes the join table during syncSchema', async () => {
    const tables = await db.kysely.introspection.getTables()
    expect(tables.map(t => t.name)).toContain(JOIN)
    const join = tables.find(t => t.name === JOIN)!
    expect(join.columns.map(c => c.name).sort()).toEqual([
      'm2m_post_id',
      'm2m_tag_id'
    ])
  })

  it('add() links rows and .all() reads them back (both directions)', async () => {
    const post = await M2MPost.objects.create({title: 'Hello'})
    const ts = await M2MTag.objects.create({label: 'ts'})
    const orm = await M2MTag.objects.create({label: 'orm'})

    await post.tags.add(ts, orm)

    const tags = await post.tags.all()
    expect(tags.map(t => t.label).sort()).toEqual(['orm', 'ts'])

    // reverse side resolves through the same join table
    const back = await ts.posts.all()
    expect(back.map(p => p.title)).toEqual(['Hello'])

    expect(await post.tags.count()).toBe(2)

    // thenable: `await post.tags` resolves the list
    const awaited = await post.tags
    expect(awaited.map(t => t.label).sort()).toEqual(['orm', 'ts'])
  })

  it('add/remove/set work with PRIMARY KEYS (and {id} objects), not just instances', async () => {
    const post = await M2MPost.objects.create({title: 'ByKey'})
    const a = await M2MTag.objects.create({label: 'a'})
    const b = await M2MTag.objects.create({label: 'b'})
    const c = await M2MTag.objects.create({label: 'c'})

    await post.tags.add(a.id, b.id) // bare PK values — no instance/fetch needed
    expect((await post.tags.all()).map(t => t.label).sort()).toEqual(['a', 'b'])

    await post.tags.remove(a.id) // unlink by key
    expect((await post.tags.all()).map(t => t.label)).toEqual(['b'])

    await post.tags.set([c.id, {id: a.id} as any]) // replace by key + {id} object
    expect((await post.tags.all()).map(t => t.label).sort()).toEqual(['a', 'c'])

    await post.tags.add(b) // instances still work (mixed usage)
    expect((await post.tags.all()).map(t => t.label).sort()).toEqual(['a', 'b', 'c'])
  })

  it('add() is idempotent (no duplicate links)', async () => {
    const post = await M2MPost.objects.create({title: 'Dup'})
    const tag = await M2MTag.objects.create({label: 'dup'})
    await post.tags.add(tag)
    await post.tags.add(tag) // ON CONFLICT DO NOTHING
    expect(await post.tags.count()).toBe(1)
  })

  it('remove() unlinks without deleting the target row', async () => {
    const post = await M2MPost.objects.create({title: 'Rm'})
    const a = await M2MTag.objects.create({label: 'a'})
    const b = await M2MTag.objects.create({label: 'b'})
    await post.tags.add(a, b)
    await post.tags.remove(a)

    const tags = await post.tags.all()
    expect(tags.map(t => t.label)).toEqual(['b'])
    // target row survives
    expect(await M2MTag.objects.get({id: a.id})).toBeTruthy()
  })

  it('set() replaces the full link set in one transaction', async () => {
    const post = await M2MPost.objects.create({title: 'Set'})
    const x = await M2MTag.objects.create({label: 'x'})
    const y = await M2MTag.objects.create({label: 'y'})
    const z = await M2MTag.objects.create({label: 'z'})
    await post.tags.add(x, y)
    await post.tags.set([y, z])

    const tags = await post.tags.all()
    expect(tags.map(t => t.label).sort()).toEqual(['y', 'z'])
  })

  it('clear() drops every link', async () => {
    const post = await M2MPost.objects.create({title: 'Clear'})
    const t = await M2MTag.objects.create({label: 'c'})
    await post.tags.add(t)
    await post.tags.clear()
    expect(await post.tags.count()).toBe(0)
  })
})

// A Prisma-style binding: an explicit join table with `A`/`B` columns (what
// `pylon db baseline` emits for an adopted implicit join table).
@model({table: 'm2m_px'})
class M2MPx extends Model {
  static objects = manager(M2MPx)
  id = id()
  name = text()
  tags = manyToMany(() => M2MTx, {
    through: '_PxToTx',
    sourceColumn: 'A',
    targetColumn: 'B'
  })
}

@model({table: 'm2m_tx'})
class M2MTx extends Model {
  static objects = manager(M2MTx)
  id = id()
  label = text()
  posts = manyToMany(() => M2MPx, {
    through: '_PxToTx',
    sourceColumn: 'B',
    targetColumn: 'A'
  })
}

describe.skipIf(!runDb)('Many-to-many with explicit join columns (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('_PxToTx').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('m2m_px').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('m2m_tx').ifExists().cascade().execute()
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('_PxToTx').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('m2m_px').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('m2m_tx').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('synthesizes the named join table with the explicit A/B columns', async () => {
    const tables = await db.kysely.introspection.getTables()
    const join = tables.find(t => t.name === '_PxToTx')
    expect(join).toBeDefined()
    expect(join!.columns.map(c => c.name).sort()).toEqual(['A', 'B'])
  })

  it('round-trips through the explicit columns (both directions)', async () => {
    const px = await M2MPx.objects.create({name: 'p'})
    const t1 = await M2MTx.objects.create({label: 't1'})
    const t2 = await M2MTx.objects.create({label: 't2'})
    await px.tags.add(t1, t2)
    expect((await px.tags.all()).map(t => t.label).sort()).toEqual(['t1', 't2'])
    // reverse side uses the mirrored columns (B/A)
    expect((await t1.posts.all()).map(p => p.name)).toEqual(['p'])

    await px.tags.remove(t1)
    expect((await px.tags.all()).map(t => t.label)).toEqual(['t2'])
  })
})
