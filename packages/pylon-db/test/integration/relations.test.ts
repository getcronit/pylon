import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  Model,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  manager,
  model,
  setDefaultDatabase,
  syncSchema,
  text,
  type Relation
} from '../../src/index'

@model()
class Author extends Model {
  static objects = manager(Author)
  id = id()
  name = text()
  posts = hasMany(() => Post, {foreignKey: 'authorId'})
}

@model()
class Post extends Model {
  static objects = manager(Post)
  id = id()
  title = text()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
}

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://pylon:pylon@localhost:5433/pylon_test'

const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('Relations (Postgres)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('post').ifExists().cascade().execute()
    await db.kysely.schema.dropTable('author').ifExists().cascade().execute()
    await syncSchema()
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('post').ifExists().cascade().execute()
      await db.kysely.schema.dropTable('author').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('resolves a belongsTo accessor to the related instance', async () => {
    const ada = await Author.objects.create({name: 'Ada'})
    const post = await Post.objects.create({title: 'On Engines', authorId: ada.id})

    const author = await post.author
    expect(author).toBeInstanceOf(Author)
    expect(author?.id).toBe(ada.id)
    expect(author?.name).toBe('Ada')
  })

  it('returns null for a belongsTo with a null foreign key', async () => {
    // Recreate the table with a nullable FK is overkill; instead assert the
    // accessor short-circuits when the scalar is null.
    const orphan = new Post()
    ;(orphan as any).authorId = null
    expect(await orphan.author).toBeNull()
  })

  it('lists children through a hasMany RelatedManager (thenable + chainable)', async () => {
    const grace = await Author.objects.create({name: 'Grace'})
    await Post.objects.create({title: 'A', authorId: grace.id})
    await Post.objects.create({title: 'B', authorId: grace.id})

    // Thenable: await resolves to the full list.
    const all = await grace.posts
    expect(all.length).toBe(2)

    // Chainable: filter/count compose on top of the FK scope.
    expect(await grace.posts.count()).toBe(2)
    const onlyA = await grace.posts.filter({title: 'A'}).all()
    expect(onlyA.length).toBe(1)
    expect(onlyA[0].title).toBe('A')
  })

  it('creates a child with the foreign key pre-filled', async () => {
    const alan = await Author.objects.create({name: 'Alan'})
    const post = await alan.posts.create({title: 'Computable Numbers'})

    expect(post.authorId).toBe(alan.id)
    expect((await post.author)?.name).toBe('Alan')
  })

  it('batches belongsTo loads into a single query (no N+1)', async () => {
    const x = await Author.objects.create({name: 'X'})
    const y = await Author.objects.create({name: 'Y'})
    await Post.objects.create({title: 'x1', authorId: x.id})
    await Post.objects.create({title: 'x2', authorId: x.id})
    await Post.objects.create({title: 'y1', authorId: y.id})

    const posts = await Post.objects.filter({title: 'x1'}).all()
    // Reload a batch of posts spanning both authors.
    const batch = await Post.objects.orderBy('id').all()

    db.resetQueryCount()
    const authors = await Promise.all(batch.map(p => p.author))
    // Many posts, two distinct authors → exactly one SELECT ... IN (...).
    expect(db.queryCount).toBe(1)
    expect(authors.every(a => a instanceof Author)).toBe(true)
    expect(posts.length).toBe(1)
  })

  it('hasMany.createMany inserts children in one round-trip with the FK pre-filled', async () => {
    const author = await Author.objects.create({name: 'Bulk'})
    db.resetQueryCount()
    const posts = await author.posts.createMany([{title: 'p1'}, {title: 'p2'}, {title: 'p3'}])
    expect(db.queryCount).toBe(1) // single INSERT, not 3
    expect(posts).toHaveLength(3)
    expect(posts.every(p => (p as any).authorId === author.id)).toBe(true)
    expect((await author.posts.all()).map(p => p.title).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('hasMany.set replaces the whole child set (delete + bulk insert)', async () => {
    const author = await Author.objects.create({name: 'Setter'})
    await author.posts.createMany([{title: 'old1'}, {title: 'old2'}])
    await author.posts.set([{title: 'new1'}, {title: 'new2'}, {title: 'new3'}])
    expect((await author.posts.all()).map(p => p.title).sort()).toEqual(['new1', 'new2', 'new3'])
  })

  it('batches hasMany loads across parents into a single query (no N+1)', async () => {
    const p = await Author.objects.create({name: 'P'})
    const q = await Author.objects.create({name: 'Q'})
    await p.posts.createMany([{title: 'p-a'}, {title: 'p-b'}])
    await q.posts.createMany([{title: 'q-a'}])
    const r = await Author.objects.create({name: 'R'}) // no posts

    const authors = await Author.objects
      .filter({})
      .orderBy('id')
      .all()
      .then(all => all.filter(a => ['P', 'Q', 'R'].includes(a.name)))

    db.resetQueryCount()
    // Resolve every author's posts in the same tick → one SELECT ... WHERE fk IN (...)
    const lists = await Promise.all(authors.map(a => a.posts))
    expect(db.queryCount).toBe(1)
    const byName = Object.fromEntries(authors.map((a, i) => [a.name, lists[i]]))
    expect(byName.P.map(x => x.title).sort()).toEqual(['p-a', 'p-b'])
    expect(byName.Q.map(x => x.title)).toEqual(['q-a'])
    expect(byName.R).toEqual([]) // a parent with no children → empty array
  })
})
