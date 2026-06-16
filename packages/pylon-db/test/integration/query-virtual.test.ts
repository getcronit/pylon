/**
 * End-to-end proof for the Query API's @model({query}) config (Phase 3): a
 * virtual/derived field compiles its custom predicate to real SQL, and the public
 * allowlist gates the public surface. Postgres-only.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  connect,
  Database,
  id,
  manager,
  Model,
  model,
  numeric,
  QueryParseError,
  setDefaultDatabase,
  syncSchema,
  text
} from '../../src/index'

@model({
  table: 'qv_item',
  query: {
    fields: {
      cheap: {toWhere: (_op, v) => (v === 'true' ? {price: {lt: 10}} : {price: {gte: 10}})}
    },
    public: ['title', 'cheap']
  }
})
class QvItem extends Model {
  static objects = manager(QvItem)
  id = id()
  title = text()
  price = numeric({precision: 10, scale: 2})
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('Query API virtual fields + public allowlist (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    await db.kysely.schema.dropTable('qv_item').ifExists().cascade().execute()
    await syncSchema()
    await QvItem.objects.create({title: 'Pin', price: 5})
    await QvItem.objects.create({title: 'Lamp', price: 50})
  })
  afterAll(async () => {
    if (db) await db.kysely.schema.dropTable('qv_item').ifExists().cascade().execute()
    if (db) await db.destroy()
    setDefaultDatabase(undefined)
  })

  it('a virtual field compiles its predicate to SQL', async () => {
    expect((await QvItem.objects.query('cheap:true').all()).map(i => i.title)).toEqual(['Pin'])
    expect((await QvItem.objects.query('cheap:false').all()).map(i => i.title)).toEqual(['Lamp'])
  })

  it('the public allowlist permits whitelisted fields', async () => {
    const hits = await QvItem.objects.query('cheap:true', {scope: 'public'}).all()
    expect(hits.map(i => i.title)).toEqual(['Pin'])
  })

  it('the public allowlist rejects a non-whitelisted column', async () => {
    // `price` is a real column but not on the public allowlist → hard error before SQL
    expect(() => QvItem.objects.query('price:5', {scope: 'public'})).toThrow(QueryParseError)
  })
})
