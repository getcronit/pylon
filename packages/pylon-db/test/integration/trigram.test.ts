/**
 * Trigram substring search: a `pg_trgm` `gin_trgm_ops` GIN index on existing
 * text columns (`@model({trigram})`), so a `{contains}` (`ILIKE '%x%'`) filter
 * matches a fragment *inside* a token — which FTS (whole-word/prefix) can't —
 * and is index-backed instead of a sequential scan. Postgres-only.
 */
import {sql} from 'kysely'
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

@model({table: 'trgm_item', trigram: {columns: ['sku', 'barcode']}})
class TrgmItem extends Model {
  static objects = manager(TrgmItem)
  id = id()
  sku = text({nullable: true})
  barcode = text({nullable: true})
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe('trigram IR (unit)', () => {
  it('emits a `gin_trgm_ops` GIN index per trigram column', () => {
    const e = entityFromDefinition(getModelDefinitionOrThrow(TrgmItem))
    const trgm = (e.indexes ?? []).filter(i => i.ops === 'gin_trgm_ops')
    expect(trgm.flatMap(i => i.columns).sort()).toEqual(['barcode', 'sku'])
    expect(trgm.every(i => i.method === 'gin')).toBe(true)
    expect(trgm.map(i => i.name).sort()).toEqual(['trgm_item_barcode_trgm', 'trgm_item_sku_trgm'])
  })

  it('synthesizes NO column (it indexes the existing column directly)', () => {
    const e = entityFromDefinition(getModelDefinitionOrThrow(TrgmItem))
    // unlike `search`, trigram adds no hidden generated column to the table
    expect(e.fields.map(f => f.name).sort()).toEqual(['barcode', 'id', 'sku'])
  })
})

describe.skipIf(!runDb)('trigram substring search (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('trgm_item').ifExists().cascade().execute()
    await syncSchema()
    await TrgmItem.objects.create({sku: 'ABC-12345-XYZ', barcode: '5012345678900'})
    await TrgmItem.objects.create({sku: 'QRS-99999-XYZ', barcode: '4006381333931'})
    await TrgmItem.objects.create({sku: 'ZZZ-00000-AAA', barcode: '0000000000000'})
  })
  afterAll(async () => {
    if (db) await db.kysely.schema.dropTable('trgm_item').ifExists().cascade().execute()
    if (db) await db.destroy()
    setDefaultDatabase(undefined)
  })

  it('creates the `gin_trgm_ops` index + the pg_trgm extension', async () => {
    const ext = await sql<{extname: string}>`select extname from pg_extension where extname = 'pg_trgm'`.execute(
      db.kysely
    )
    expect(ext.rows.map(r => r.extname)).toContain('pg_trgm')
    const idx = await sql<{indexdef: string}>`
      select indexdef from pg_indexes where tablename = 'trgm_item' and indexname = 'trgm_item_sku_trgm'
    `.execute(db.kysely)
    expect(idx.rows[0]?.indexdef).toMatch(/USING gin \(sku gin_trgm_ops\)/)
  })

  it('`contains` matches a fragment INSIDE a token (what FTS cannot do)', async () => {
    // `234` sits mid-token in `ABC-12345-XYZ` (the `12345` block) — never a word
    // start, so a prefix/FTS match would miss it; a trigram ILIKE finds it.
    const hits = await TrgmItem.objects.filter({sku: {contains: '234'}}).all()
    expect(hits.map(h => h.sku)).toEqual(['ABC-12345-XYZ'])
  })

  it('matches a barcode fragment too', async () => {
    const hits = await TrgmItem.objects.filter({barcode: {contains: '638133'}}).all()
    expect(hits.map(h => h.sku)).toEqual(['QRS-99999-XYZ'])
  })

  it('the planner CAN use the trigram index for the substring ILIKE', async () => {
    // Tiny table → the planner prefers a seq scan; force it off to prove the
    // index is eligible (on a real-sized table it's chosen automatically).
    await sql`set enable_seqscan = off`.execute(db.kysely)
    try {
      const plan = await sql<{['QUERY PLAN']: string}>`
        explain select * from trgm_item where sku ilike ${'%234%'}
      `.execute(db.kysely)
      const text = plan.rows.map(r => r['QUERY PLAN']).join('\n')
      expect(text).toMatch(/trgm_item_sku_trgm/)
    } finally {
      await sql`set enable_seqscan = on`.execute(db.kysely)
    }
  })
})
