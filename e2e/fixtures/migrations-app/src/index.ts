// Fixture for the "existing migrations" e2e: a project whose schema is managed
// by committed, hand-authored migration files (see ./migrations). The models
// here match what those migrations build; `snapshot.json` is their captured
// baseline, so `pylon db status` reports no uncaptured changes.
import {Pylon} from '@getcronit/pylon'
import {models, db, type ModelConfig} from '@getcronit/pylon/db'
import type {Relation} from '@getcronit/pylon/db'

export class ShopCategory extends models.Model {
  static config = {table: 'shop_category'} satisfies ModelConfig<ShopCategory>
  static objects = db.manager(ShopCategory)
  id = models.ID()
  name = models.Text({unique: true})
  products = models.HasMany(() => ShopProduct, {foreignKey: 'categoryId'})
}

export class ShopProduct extends models.Model {
  static config = {table: 'shop_product'} satisfies ModelConfig<ShopProduct>
  static objects = db.manager(ShopProduct)
  id = models.ID()
  title = models.Text({index: true})
  categoryId = models.ForeignKey(() => ShopCategory)
  declare category: Relation<ShopCategory>
}

export default new Pylon({
  db: {models: [ShopCategory, ShopProduct]},
  graphql: {
    Query: {},
    Mutation: {}
  }
})
