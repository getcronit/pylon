/**
 * Postgres full-text search: a STORED-generated `tsvector` column (auto-synced
 * from text columns) + `.search()` (websearch_to_tsquery). Postgres-only.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  Database,
  id,
  manager,
  Model,
  model,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'
import {entityFromDefinition} from '../../src/ir'
import {getModelDefinitionOrThrow} from '../../src/registry'

@model({table: 'fts_doc', search: {columns: ['title', 'body'], language: 'english'}})
class FtsDoc extends Model {
  static objects = manager(FtsDoc)
  id = id()
  title = text()
  body = text()
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('FTS IR (unit)', () => {
  it('marks the tsvector column generated + postgres-required, hidden, GIN-indexed', () => {
    const e = entityFromDefinition(getModelDefinitionOrThrow(FtsDoc))
    const fts = e.fields.find(f => f.name === 'fts')!
    expect(fts.exposed).toBe(false) // hidden from GraphQL
    expect(fts.column?.generatedAs).toMatch(/to_tsvector\('english'/)
    expect(fts.column?.requires).toBe('postgres')
    const gin = (e.indexes ?? []).find(i => i.method === 'gin')
    expect(gin?.columns).toEqual(['fts'])
  })
})

describe.skipIf(!runDb)('full-text search (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('fts_doc').ifExists().cascade().execute()
    await syncSchema()
    await FtsDoc.objects.create({title: 'The quick brown fox', body: 'jumps over the lazy dog'})
    await FtsDoc.objects.create({title: 'Postgres full text', body: 'tsvector and gin indexes'})
    await FtsDoc.objects.create({title: 'Unrelated', body: 'nothing to see'})
  })
  afterAll(async () => {
    if (db) await db.kysely.schema.dropTable('fts_doc').ifExists().cascade().execute()
    if (db) await db.destroy()
    setDefaultDatabase(undefined)
  })

  it('the tsvector column is auto-populated (generated) from title + body', async () => {
    const row = await db.kysely
      .selectFrom('fts_doc')
      .select(['title', 'fts'])
      .where('title', '=', 'The quick brown fox')
      .executeTakeFirstOrThrow()
    expect(String((row as any).fts)).toContain('fox')
  })

  it('.search() matches on the generated vector', async () => {
    const hits = await FtsDoc.objects.search('fox').all()
    expect(hits.map(d => d.title)).toEqual(['The quick brown fox'])
  })

  it('.search() handles plain multi-word input (websearch syntax)', async () => {
    const hits = await FtsDoc.objects.search('postgres tsvector').all()
    expect(hits.map(d => d.title)).toEqual(['Postgres full text'])
  })

  it('.search() composes with filters + pagination', async () => {
    const page = await FtsDoc.objects.search('dog').paginate({first: 10})
    expect(page.totalCount).toBe(1)
    expect(page.nodes[0].title).toBe('The quick brown fox')
  })
})
