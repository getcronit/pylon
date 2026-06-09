import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  Model,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  model,
  setDefaultDatabase,
  syncSchema,
  text,
  type Relation
} from '../../src/index'

@model()
class Author extends Model {
  id = id()
  name = text()
  posts = hasMany(() => Post, {foreignKey: 'authorId'})
}

@model()
class Post extends Model {
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
    const ada = await Author.create({name: 'Ada'})
    const post = await Post.create({title: 'On Engines', authorId: ada.id})

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
    const grace = await Author.create({name: 'Grace'})
    await Post.create({title: 'A', authorId: grace.id})
    await Post.create({title: 'B', authorId: grace.id})

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
    const alan = await Author.create({name: 'Alan'})
    const post = await alan.posts.create({title: 'Computable Numbers'})

    expect(post.authorId).toBe(alan.id)
    expect((await post.author)?.name).toBe('Alan')
  })

  it('batches belongsTo loads into a single query (no N+1)', async () => {
    const x = await Author.create({name: 'X'})
    const y = await Author.create({name: 'Y'})
    await Post.create({title: 'x1', authorId: x.id})
    await Post.create({title: 'x2', authorId: x.id})
    await Post.create({title: 'y1', authorId: y.id})

    const posts = await Post.filter({title: 'x1'}).all()
    // Reload a batch of posts spanning both authors.
    const batch = await Post.orderBy('id').all()

    db.resetQueryCount()
    const authors = await Promise.all(batch.map(p => p.author))
    // Many posts, two distinct authors → exactly one SELECT ... IN (...).
    expect(db.queryCount).toBe(1)
    expect(authors.every(a => a instanceof Author)).toBe(true)
    expect(posts.length).toBe(1)
  })
})
