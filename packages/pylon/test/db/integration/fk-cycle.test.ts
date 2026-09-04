/**
 * A FK CYCLE between two tables (`Product.groupOptionId → ProductOption`,
 * `ProductOption.productId → Product`) can't be expressed with inline
 * `REFERENCES` in `CREATE TABLE` — no creation order satisfies both. `syncSchema`
 * must create the tables first, then add the FK constraints. Regression for the
 * lokalis products schema, whose fresh `db push` wedged on exactly this cycle.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {
  type ModelConfig,
  connect,
  Database,
  foreignKey,
  id,
  manager,
  Model,
  setDefaultDatabase,
  syncSchema,
  text,
  type Relation
} from '@/db/index'

class CycProduct extends Model {
  static config = {table: 'cyc_product'} satisfies ModelConfig<CycProduct>
  static objects = manager(CycProduct)
  id = id({snowflake: true})
  name = text()
  // Nullable FK to an option — the back-edge that closes the cycle.
  groupOptionId = foreignKey(() => CycOption, {nullable: true})
  declare groupOption: Relation<CycOption>
}
new Pylon({db: {models: [CycProduct]}})

class CycOption extends Model {
  static config = {table: 'cyc_option'} satisfies ModelConfig<CycOption>
  static objects = manager(CycOption)
  id = id({snowflake: true})
  label = text()
  productId = foreignKey(() => CycProduct, {onDelete: 'cascade'})
  declare product: Relation<CycProduct>
}
new Pylon({db: {models: [CycOption]}})

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://pylon:pylon@localhost:5433/pylon_test'
const runDb = process.env.DATABASE_URL || process.env.PYLON_ORM_IT

describe.skipIf(!runDb)('FK cycle (Postgres)', () => {
  let db: Database
  beforeAll(async () => {
    db = connect({connectionString})
    for (const t of ['cyc_option', 'cyc_product']) {
      await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
    }
    await syncSchema()
  })
  afterAll(async () => {
    if (db) {
      for (const t of ['cyc_option', 'cyc_product']) {
        await db.kysely.schema.dropTable(t).ifExists().cascade().execute()
      }
      await db.destroy()
    }
    setDefaultDatabase(undefined)
  })

  it('creates both tables and both FK constraints despite the cycle', async () => {
    // Both tables exist…
    const tables = await db.kysely
      .selectFrom('pg_tables' as never)
      .select('tablename' as never)
      .where('schemaname' as never, '=', 'public' as never)
      .where('tablename' as never, 'in', ['cyc_product', 'cyc_option'] as never)
      .execute()
    expect(tables.map((t: any) => t.tablename).sort()).toEqual(['cyc_option', 'cyc_product'])

    // …and both FK constraints landed (the cycle's two edges).
    const fks = await db.kysely
      .selectFrom('information_schema.table_constraints' as never)
      .select('constraint_name' as never)
      .where('constraint_type' as never, '=', 'FOREIGN KEY' as never)
      .where('table_name' as never, 'in', ['cyc_product', 'cyc_option'] as never)
      .execute()
    expect(fks.length).toBe(2)
  })

  it('links a product to an option across the cycle at runtime', async () => {
    const product = await CycProduct.objects.create({name: 'Boot'})
    const option = await CycOption.objects.create({label: 'Size', productId: product.id})
    product.groupOptionId = option.id
    await product.$save()
    const reloaded = await CycProduct.objects.get({id: product.id})
    expect(reloaded.groupOptionId).toBe(option.id)
  })

  it('re-running syncSchema is idempotent (FK constraints not duplicated)', async () => {
    await syncSchema() // no throw on the already-present constraints
    const fks = await db.kysely
      .selectFrom('information_schema.table_constraints' as never)
      .select('constraint_name' as never)
      .where('constraint_type' as never, '=', 'FOREIGN KEY' as never)
      .where('table_name' as never, 'in', ['cyc_product', 'cyc_option'] as never)
      .execute()
    expect(fks.length).toBe(2)
  })
})
