/**
 * Relation-predicate filtering (Prisma-style) against a real Postgres:
 *  - belongsTo: `{ author: { name: … } }` (+ PK peephole → local FK)
 *  - hasMany / m2m: `{ articles: { some | every | none: … } }`
 *  - nested two levels, combined with scalar fields
 *  - pagination/count stay correct (EXISTS, not a JOIN → no row duplication)
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  boolean,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  manager,
  manyToMany,
  Model,
  type Relation,
  setDefaultDatabase,
  syncSchema,
  text,
  type WhereInput
} from '@/db/index'

class Author extends Model {
  static config = {table: 'rf_author'} satisfies ModelConfig<Author>
  static objects = manager(Author)
  id = id()
  name = text()
  active = boolean()
  articles = hasMany(() => Article, {foreignKey: 'authorId'})
}
new Pylon({db: {models: [Author]}})

class Article extends Model {
  static config = {table: 'rf_article'} satisfies ModelConfig<Article>
  static objects = manager(Article)
  id = id()
  title = text()
  published = boolean()
  authorId = foreignKey(() => Author)
  declare author: Relation<Author>
  tags = manyToMany(() => Tag)
}
new Pylon({db: {models: [Article]}})

class Tag extends Model {
  static config = {table: 'rf_tag'} satisfies ModelConfig<Tag>
  static objects = manager(Tag)
  id = id()
  label = text()
  articles = manyToMany(() => Article, {paginate: true})
}
new Pylon({db: {models: [Tag]}})

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

  it('paginated m2m connection filters by a target `query` (ManyToManyManager.filter)', async () => {
    // A tag linked to a MIX of published + draft articles.
    const mix = await Tag.objects.create({label: 'mix'})
    const a1 = (await Article.objects.filter({title: 'A1'}).first())! // published
    const g2 = (await Article.objects.filter({title: 'G2'}).first())! // draft
    await mix.articles.add(a1, g2)

    // Baseline: the unfiltered paginated accessor returns BOTH links. (The relation
    // accessor yields a LAZY connection — nodes/totalCount are awaited getters.)
    const all = (mix.articles as any)()
    expect(await all.totalCount).toBe(2)
    expect((await all.nodes).map((a: any) => a.title).sort()).toEqual(['A1', 'G2'])

    // `.filter(where)` — the core: page + count apply the target WHERE on the join.
    const pub = await mix.articles.filter({published: true}).paginate({first: 10, orderBy: 'title'})
    expect(pub.totalCount).toBe(1)
    expect(pub.nodes.map(a => a.title)).toEqual(['A1'])
    // lazy twin resolves the same filtered count.
    const lazyPub = mix.articles.filter({published: true}).paginateLazy({first: 10})
    expect(await lazyPub.totalCount).toBe(1)

    // End-to-end: the connection's `query` arg (6th positional) → parseSearchQuery →
    // the same target filter, exactly like a paginated hasMany.
    const viaQuery = (mix.articles as any)(10, undefined, undefined, undefined, undefined, 'published:false')
    expect(await viaQuery.totalCount).toBe(1)
    expect((await viaQuery.nodes).map((a: any) => a.title)).toEqual(['G2'])
  })
})
