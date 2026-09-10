/**
 * Postgres full-text search: a STORED-generated `tsvector` column (auto-synced
 * from text columns) + `.search()` (websearch_to_tsquery). Postgres-only.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  id,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text
} from '@/db/index'
import {entityFromDefinition} from '@/db/ir'
import {getModelDefinitionOrThrow} from '@/db/registry'

class FtsDoc extends Model {
  static config = {table: 'fts_doc', search: {columns: ['title', 'body'], language: 'english'}} satisfies ModelConfig<FtsDoc>
  static objects = manager(FtsDoc)
  id = id()
  title = text()
  body = text()
}
new Pylon({db: {models: [FtsDoc]}})

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

  it('does NOT fetch/hydrate the generated tsvector (it is never read as a value)', async () => {
    const doc = await FtsDoc.objects.get({title: 'Unrelated'})
    expect((doc as any).fts).toBeUndefined() // not selected
    expect(Object.keys(doc)).not.toContain('fts') // not on the instance
    expect(Object.keys(JSON.parse(JSON.stringify(doc)))).not.toContain('fts')
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

  it('anchor seek is rejected under relevance ordering (no seekable key)', async () => {
    const anchor = (await FtsDoc.objects.get({title: 'Unrelated'})).id
    await expect(
      FtsDoc.objects.search('text', {rank: true}).paginate({first: 5, anchor})
    ).rejects.toThrow(/relevance|seekable key/i)
  })

  it('syncSchema (db push) creates the GIN index, not just the column', async () => {
    const idx = await db.kysely
      .selectFrom('pg_indexes' as any)
      .select(['indexdef'] as any)
      .where('tablename' as any, '=', 'fts_doc')
      .execute()
    expect(idx.some((r: any) => /USING gin/.test(r.indexdef))).toBe(true)
  })

  it('$save updates a loaded row WITHOUT writing the generated tsvector', async () => {
    // .get() selectAll() hydrates the STORED generated `fts` column onto the
    // instance; $save() must NOT write it back (Postgres rejects GENERATED
    // ALWAYS columns). This regression once blocked every update on a
    // search-enabled model.
    const doc = await FtsDoc.objects.get({title: 'Unrelated'})
    doc.body = 'now mentions falcon'
    await expect(doc.$save()).resolves.toBeTruthy()

    // the field changed AND the generated vector re-synced to the new body
    const reloaded = await FtsDoc.objects.get({id: doc.id})
    expect(reloaded.body).toBe('now mentions falcon')
    expect((await FtsDoc.objects.search('falcon').all()).map(d => d.id)).toContain(doc.id)
  })
})

class FtsMulti extends Model {
  static config = {
  table: 'fts_multi',
  search: [
    {name: 'titleFts', columns: ['title']},
    {name: 'bodyFts', columns: ['body']}
  ]
} satisfies ModelConfig<FtsMulti>
  static objects = manager(FtsMulti)
  id = id()
  title = text()
  body = text()
}
new Pylon({db: {models: [FtsMulti]}})

describe.skipIf(!runDb)('multiple search sets (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('fts_multi').ifExists().cascade().execute()
    await syncSchema()
    await FtsMulti.objects.create({title: 'alpha keyword', body: 'beta content'})
  })
  afterAll(async () => {
    if (db) await db.kysely.schema.dropTable('fts_multi').ifExists().cascade().execute()
    if (db) await db.destroy()
    setDefaultDatabase(undefined)
  })

  it('synthesizes one tsvector column + GIN per search set', async () => {
    const cols = await db.kysely.introspection.getTables()
    const t = cols.find(x => x.name === 'fts_multi')!
    const names = t.columns.map(c => c.name)
    expect(names).toContain('titleFts')
    expect(names).toContain('bodyFts')
    const idx = await db.kysely
      .selectFrom('pg_indexes' as any)
      .select(['indexdef'] as any)
      .where('tablename' as any, '=', 'fts_multi')
      .execute()
    expect(idx.filter((r: any) => /USING gin/.test(r.indexdef))).toHaveLength(2)
  })

  it('.search() targets a specific set by column', async () => {
    // "keyword" is only in title → titleFts matches, bodyFts does not
    expect(
      (await FtsMulti.objects.search('keyword', {column: 'titleFts'}).all()).length
    ).toBe(1)
    expect(
      (await FtsMulti.objects.search('keyword', {column: 'bodyFts'}).all()).length
    ).toBe(0)
    // "content" is only in body
    expect(
      (await FtsMulti.objects.search('content', {column: 'bodyFts'}).all()).length
    ).toBe(1)
  })
})
