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
