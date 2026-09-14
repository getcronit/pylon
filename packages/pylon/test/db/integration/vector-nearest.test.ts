import {sql} from 'kysely'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  Model,
  connect,
  Database,
  id,
  manager,
  models,
  setDefaultDatabase,
  syncSchema,
  text
} from '@/db/index'

const {Vector} = models

// End-to-end pgvector: extension (F3) + `vector(3)` column (F1) + `{index:true}`
// HNSW/cosine ANN index (F2) + `.nearest().matches()` (F4), all through `db push`.
class Doc extends Model {
  static objects = manager(Doc)
  id = id()
  title = text()
  embedding = Vector({dim: 3, index: true})
}
new Pylon({db: {models: [Doc]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('pgvector .nearest().matches() (Postgres + pgvector)', () => {
  let db: Database

  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('doc').ifExists().cascade().execute()
    await syncSchema() // CREATE EXTENSION vector → table vector(3) → HNSW index
    // Unit vectors: `up` is identical to the query, `diag` is 45°, `right` is 90°.
    await Doc.objects.create({title: 'up', embedding: [1, 0, 0]})
    await Doc.objects.create({title: 'right', embedding: [0, 1, 0]})
    await Doc.objects.create({title: 'diag', embedding: [1, 1, 0]})
  })

  afterAll(async () => {
    if (db) {
      await db.kysely.schema.dropTable('doc').ifExists().cascade().execute()
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('created the `vector` extension (F3)', async () => {
    const {rows} = await sql`SELECT 1 FROM pg_extension WHERE extname = 'vector'`.execute(db.kysely)
    expect(rows.length).toBe(1)
  })

  it('created the HNSW ANN index with the cosine operator class (F2)', async () => {
    const {rows} = await sql<{indexdef: string}>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'doc' AND indexname = 'doc_embedding_hnsw'
    `.execute(db.kysely)
    expect(rows.length).toBe(1)
    expect(rows[0].indexdef).toMatch(/USING hnsw .*vector_cosine_ops/)
  })

  it('.nearest().matches() orders by cosine similarity, closest first, with scores', async () => {
    const m = await Doc.objects.nearest([1, 0, 0]).matches()
    expect(m.map(x => x.item.title)).toEqual(['up', 'diag', 'right'])
    expect(m[0].score).toBeCloseTo(1, 5) // identical → cosine similarity 1
    expect(m[1].score).toBeCloseTo(1 / Math.SQRT2, 5) // 45° → ~0.707
    expect(m[2].score).toBeCloseTo(0, 5) // orthogonal → 0
    // scores strictly descending
    expect(m[0].score).toBeGreaterThan(m[1].score)
    expect(m[1].score).toBeGreaterThan(m[2].score)
  })

  it('the item carries the plain columns but NOT the embedding (§5.2)', async () => {
    const m = await Doc.objects.nearest([1, 0, 0]).matches()
    expect(m[0].item.title).toBe('up')
    expect((m[0].item as {embedding?: unknown}).embedding).toBeUndefined()
  })

  it('`k` caps the result set (LIMIT)', async () => {
    const m = await Doc.objects.nearest([1, 0, 0], {k: 2}).matches()
    expect(m.map(x => x.item.title)).toEqual(['up', 'diag'])
  })

  it('.all() on a nearest query returns the rows sorted by distance, no score', async () => {
    const rows = await Doc.objects.nearest([1, 0, 0]).all()
    expect(rows.map(r => r.title)).toEqual(['up', 'diag', 'right'])
    expect((rows[0] as {embedding?: unknown}).embedding).toBeUndefined()
  })

  it('.nearest() composes with .filter() (pre-filter before the ANN scan)', async () => {
    const m = await Doc.objects.filter({title: 'right'}).nearest([1, 0, 0]).matches()
    expect(m.map(x => x.item.title)).toEqual(['right'])
  })
})
