/**
 * Proves cross-table search via a virtual `search` field whose toWhere ORs FTS
 * predicates across the model AND a relation — the union the old per-model
 * searchIds() did, expressed as one WhereInput. Postgres-only.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  Database,
  foreignKey,
  id,
  manager,
  Model,
  model,
  type Relation,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'

@model({table: 'xs_author', search: {columns: ['bio']}})
class XsAuthor extends Model {
  static objects = manager(XsAuthor)
  id = id()
  bio = text()
}

@model({
  table: 'xs_book',
  search: {columns: ['title']},
  query: {
    fields: {
      // bare-term `search` across the book's own FTS + the author's FTS
      search: {
        toWhere: (_op, v) => ({
          OR: [{fts: {search: v}}, {author: {fts: {search: v}}}]
        })
      }
    }
  }
})
class XsBook extends Model {
  static objects = manager(XsBook)
  id = id()
  title = text()
  authorId = foreignKey(() => XsAuthor)
  declare author: Relation<XsAuthor>
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('cross-table search virtual (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['xs_book', 'xs_author']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
    const rare = await XsAuthor.objects.create({bio: 'rare botany expert'})
    const boring = await XsAuthor.objects.create({bio: 'general writer'})
    await XsBook.objects.create({title: 'Common Title', authorId: rare.id}) // matches via AUTHOR
    await XsBook.objects.create({title: 'Botany Basics', authorId: boring.id}) // matches via OWN title
    await XsBook.objects.create({title: 'Cooking', authorId: boring.id}) // no match
  })
  afterAll(async () => {
    if (db) {
      for (const t of ['xs_book', 'xs_author']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('matches rows whose OWN or RELATION FTS hits the term', async () => {
    const hits = await XsBook.objects.query('search:botany').all()
    expect(hits.map(b => b.title).sort()).toEqual(['Botany Basics', 'Common Title'])
  })

  it('the virtual composes with other clauses', async () => {
    // search:botany AND title:Botany* → only the own-title match
    const hits = await XsBook.objects.query('search:botany title:Botany*').all()
    expect(hits.map(b => b.title)).toEqual(['Botany Basics'])
  })
})
