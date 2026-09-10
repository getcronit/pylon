/**
 * End-to-end proof for the Query API's relation paths (Phase 2): a dotted
 * `query` string (`brand.name:…`, `variants.sku:…`) parses to a relation
 * `WhereInput` and actually executes as a join/EXISTS filter. Postgres-only.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  foreignKey,
  hasMany,
  id,
  manager,
  Model,
  type Relation,
  setDefaultDatabase,
  syncSchema,
  text
} from '@/db/index'

class QrBrand extends Model {
  static config = {table: 'qr_brand'} satisfies ModelConfig<QrBrand>
  static objects = manager(QrBrand)
  id = id()
  name = text()
}
new Pylon({db: {models: [QrBrand]}})

class QrVariant extends Model {
  static config = {table: 'qr_variant'} satisfies ModelConfig<QrVariant>
  static objects = manager(QrVariant)
  id = id()
  sku = text()
  productId = foreignKey(() => QrProduct)
  declare product: Relation<QrProduct>
}
new Pylon({db: {models: [QrVariant]}})

class QrProduct extends Model {
  static config = {table: 'qr_product'} satisfies ModelConfig<QrProduct>
  static objects = manager(QrProduct)
  id = id()
  title = text()
  brandId = foreignKey(() => QrBrand)
  declare brand: Relation<QrBrand>
  variants = hasMany(() => QrVariant, {foreignKey: 'productId'})
}
new Pylon({db: {models: [QrProduct]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('Query API relation paths (Postgres)', () => {
  let db: Database
  let nikeHat: string
  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['qr_variant', 'qr_product', 'qr_brand']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
    const nike = await QrBrand.objects.create({name: 'Nike'})
    const puma = await QrBrand.objects.create({name: 'Puma'})
    const hat = await QrProduct.objects.create({title: 'Cap', brandId: nike.id})
    const sock = await QrProduct.objects.create({title: 'Sock', brandId: puma.id})
    nikeHat = hat.id
    await QrVariant.objects.create({sku: 'CAP-001', productId: hat.id})
    await QrVariant.objects.create({sku: 'SOCK-999', productId: sock.id})
  })
  afterAll(async () => {
    if (db) {
      for (const t of ['qr_variant', 'qr_product', 'qr_brand']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('filters by a to-one relation field (brand.name)', async () => {
    const hits = await QrProduct.objects.query('brand.name:Nike').all()
    expect(hits.map(p => p.title)).toEqual(['Cap'])
  })

  it('filters by a to-many relation field (variants.sku, prefix)', async () => {
    const hits = await QrProduct.objects.query('variants.sku:CAP*').all()
    expect(hits.map(p => p.id)).toEqual([nikeHat])
  })

  it('composes a relation path with an own-column term', async () => {
    const hits = await QrProduct.objects.query('title:Cap brand.name:Nike').all()
    expect(hits.map(p => p.title)).toEqual(['Cap'])
    // contradictory cross-relation terms → no rows
    expect((await QrProduct.objects.query('title:Cap brand.name:Puma').all()).length).toBe(0)
  })
})
