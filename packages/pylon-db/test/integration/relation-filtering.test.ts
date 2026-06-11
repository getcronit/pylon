/**
 * Relation-predicate filtering (Prisma-style) against a real Postgres:
 *  - belongsTo: `{ author: { name: … } }` (+ PK peephole → local FK)
 *  - hasMany / m2m: `{ articles: { some | every | none: … } }`
 *  - nested two levels, combined with scalar fields
 *  - pagination/count stay correct (EXISTS, not a JOIN → no row duplication)
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  boolean,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  manager,
  manyToMany,
  Model,
  model,
  type Relation,
  setDefaultDatabase,
  syncSchema,
  text,
  type WhereInput
} from '../../src/index'

@model({table: 'rf_author'})
class Author extends Model {
  static objects = manager(Author)
  id = id()
  name = text()
  active = boolean()
  articles = hasMany(() => Article, {foreignKey: 'authorId'})
}

@model({table: 'rf_article'})
class Article extends Model {
  static objects = manager(Article)
  id = id()
  title = text()
  published = boolean()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
  tags = manyToMany(() => Tag)
}

@model({table: 'rf_tag'})
class Tag extends Model {
  static objects = manager(Tag)
  id = id()
  label = text()
  articles = manyToMany(() => Article)
}

const JOIN = 'rf_article_rf_tag'
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

// ── Compile-time contract ───────────────────────────────────────────────────
{
  const ok: WhereInput<Author> = {
    active: true,
    articles: {some: {published: true, author: {active: true}}}
  }
  void ok
  const ok2: WhereInput<Article> = {author: {name: {startsWith: 'A'}}}
  void ok2
}

describe.skipIf(!runDb)('relation filtering — EXISTS (Postgres)', () => {
  let db: Database
  const ids: Record<string, number> = {}

  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of [JOIN, 'rf_article', 'rf_tag', 'rf_author']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()

    const ada = await Author.objects.create({name: 'Ada', active: true})
    const grace = await Author.objects.create({name: 'Grace', active: true})
    const alan = await Author.objects.create({name: 'Alan', active: false}) // no articles
    ids.ada = ada.id
    ids.alan = alan.id

    const a1 = await Article.objects.create({title: 'A1', published: true, authorId: ada.id})
    await Article.objects.create({title: 'A2', published: true, authorId: ada.id})
    const g1 = await Article.objects.create({title: 'G1', published: true, authorId: grace.id})
    await Article.objects.create({title: 'G2', published: false, authorId: grace.id}) // draft

    const ts = await Tag.objects.create({label: 'ts'})
    const orm = await Tag.objects.create({label: 'orm'})
    await a1.tags.add(ts)
    await g1.tags.add(ts, orm)
  })

  afterAll(async () => {
    if (db) {
      for (const t of [JOIN, 'rf_article', 'rf_tag', 'rf_author']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  const authorNames = async (where: WhereInput<Author>) =>
    (await Author.objects.filter(where).orderBy('name').all()).map(a => a.name)
  const articleTitles = async (where: WhereInput<Article>) =>
    (await Article.objects.filter(where).orderBy('title').all()).map(a => a.title)

  it('belongsTo: filter by a related-model attribute', async () => {
    expect(await articleTitles({author: {name: 'Ada'}})).toEqual(['A1', 'A2'])
    expect(await articleTitles({author: {name: {startsWith: 'G'}}})).toEqual(['G1', 'G2'])
  })

  it('belongsTo PK peephole: {author: {id}} === {authorId} (no subquery)', async () => {
    expect(await articleTitles({author: {id: ids.ada}})).toEqual(['A1', 'A2'])
    expect(await articleTitles({authorId: ids.ada})).toEqual(['A1', 'A2'])
    // operator on the PK collapses onto the FK column too
    expect(await articleTitles({author: {id: {in: [ids.ada]}}})).toEqual(['A1', 'A2'])
  })

  it('hasMany some / none / every', async () => {
    expect(await authorNames({articles: {some: {published: true}}})).toEqual(['Ada', 'Grace'])
    // none-published: Alan (no articles → vacuously none)
    expect(await authorNames({articles: {none: {published: true}}})).toEqual(['Alan'])
    // every-published: Ada (both) + Alan (no articles → vacuously every); Grace has a draft
    expect(await authorNames({articles: {every: {published: true}}})).toEqual(['Ada', 'Alan'])
  })

  it('combines a relation predicate with scalar fields', async () => {
    expect(await authorNames({active: true, articles: {some: {published: true}}})).toEqual([
      'Ada',
      'Grace'
    ])
    expect(
      await authorNames({OR: [{name: 'Alan'}, {articles: {some: {title: 'A1'}}}]})
    ).toEqual(['Ada', 'Alan'])
  })

  it('nested two levels (article → author → articles)', async () => {
    // articles whose author also has at least one DRAFT article → only Grace's
    expect(
      await articleTitles({author: {articles: {some: {published: false}}}})
    ).toEqual(['G1', 'G2'])
  })

  it('many-to-many some', async () => {
    expect(await articleTitles({tags: {some: {label: 'ts'}}})).toEqual(['A1', 'G1'])
    expect(await articleTitles({tags: {some: {label: 'orm'}}})).toEqual(['G1'])
    expect(await articleTitles({tags: {none: {label: 'orm'}}})).toEqual(['A1', 'A2', 'G2'])
  })

  it('pagination + count stay correct (EXISTS, no row duplication)', async () => {
    // Ada has TWO published articles — a JOIN would count her twice. EXISTS counts once.
    const page = await Author.objects
      .filter({articles: {some: {published: true}}})
      .paginate({first: 10, orderBy: 'name'})
    expect(page.totalCount).toBe(2)
    expect(page.nodes.map(a => a.name)).toEqual(['Ada', 'Grace'])
  })
})
