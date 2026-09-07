import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  id,
  manager,
  manyToMany,
  Model,
  setDefaultDatabase,
  syncSchema,
  text
} from '@/db/index'

// Distinct table names so the suite never collides with other integration
// files that also register `post`/`tag` in the shared, process-global registry.
class M2MPost extends Model {
  static config = {table: 'm2m_post'} satisfies ModelConfig<M2MPost>
  static objects = manager(M2MPost)
  id = id()
  title = text()
  tags = manyToMany(() => M2MTag)
}
new Pylon({db: {models: [M2MPost]}})

class M2MTag extends Model {
  static config = {table: 'm2m_tag'} satisfies ModelConfig<M2MTag>
  static objects = manager(M2MTag)
  id = id()
  label = text()
  posts = manyToMany(() => M2MPost)
}
new Pylon({db: {models: [M2MTag]}})

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

  it('.all() order is deterministic + link-order-independent by default (PK tiebreaker)', async () => {
    // With no declared orderBy, a bare m2m used to return join rows in an
    // unspecified, plan-dependent order — so the SAME relation could come back
    // differently in two queries (a list card vs a detail sheet). The PK fallback
    // makes it total: two posts linking the same tags in DIFFERENT orders read them
    // back identically, and repeated reads never reshuffle.
    const a = await M2MTag.objects.create({label: 'aa'})
    const b = await M2MTag.objects.create({label: 'bb'})
    const c = await M2MTag.objects.create({label: 'cc'})
    const p1 = await M2MPost.objects.create({title: 'p1'})
    const p2 = await M2MPost.objects.create({title: 'p2'})
    await p1.tags.add(a, b, c)
    await p2.tags.add(c, a, b) // linked in a different order

    const o1 = (await p1.tags.all()).map(t => t.label)
    const o2 = (await p2.tags.all()).map(t => t.label)
    expect(o1).toEqual(o2) // same order regardless of how they were linked
    expect((await p1.tags.all()).map(t => t.label)).toEqual(o1) // stable on repeat
  })
})

// A Prisma-style binding: an explicit join table with `A`/`B` columns (what
// `pylon db baseline` emits for an adopted implicit join table).
class M2MPx extends Model {
  static config = {table: 'm2m_px'} satisfies ModelConfig<M2MPx>
  static objects = manager(M2MPx)
  id = id()
  name = text()
  tags = manyToMany(() => M2MTx, {
    through: '_PxToTx',
    sourceColumn: 'A',
    targetColumn: 'B'
  })
}
new Pylon({db: {models: [M2MPx]}})

class M2MTx extends Model {
  static config = {table: 'm2m_tx'} satisfies ModelConfig<M2MTx>
  static objects = manager(M2MTx)
  id = id()
  label = text()
  posts = manyToMany(() => M2MPx, {
    through: '_PxToTx',
    sourceColumn: 'B',
    targetColumn: 'A'
  })
}
new Pylon({db: {models: [M2MTx]}})

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

// A declared read order on the m2m relation (a target column, `-` = desc).
class OrdList extends Model {
  static config = {table: 'ord_list'} satisfies ModelConfig<OrdList>
  static objects = manager(OrdList)
  id = id()
  name = text()
  items = manyToMany(() => OrdItem, {orderBy: '-label'})
}
new Pylon({db: {models: [OrdList]}})

class OrdItem extends Model {
  static config = {table: 'ord_item'} satisfies ModelConfig<OrdItem>
  static objects = manager(OrdItem)
  id = id()
  label = text()
  lists = manyToMany(() => OrdList)
}
new Pylon({db: {models: [OrdItem]}})

describe.skipIf(!runDb)('Many-to-many with a declared orderBy (Postgres)', () => {
  let db: Database
  const JOIN2 = 'ord_item_ord_list'

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable(JOIN2).ifExists().cascade().execute()
    await db.kysely.schema.dropTable('ord_list').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('ord_item').ifExists().cascade().execute()
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable(JOIN2).ifExists().cascade().execute()
      await db.kysely.schema.dropTable('ord_list').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('ord_item').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('.all() sorts by the declared target column, independent of link order', async () => {
    const list = await OrdList.objects.create({name: 'l'})
    // Create + link in a deliberately non-sorted order.
    const banana = await OrdItem.objects.create({label: 'banana'})
    const apple = await OrdItem.objects.create({label: 'apple'})
    const cherry = await OrdItem.objects.create({label: 'cherry'})
    await list.items.add(banana, apple, cherry)

    // orderBy '-label' → descending by label, regardless of link/creation order.
    expect((await list.items.all()).map(i => i.label)).toEqual([
      'cherry',
      'banana',
      'apple'
    ])
  })
})
