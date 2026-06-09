// Fixture for the "existing migrations" e2e: a project whose schema is managed
// by committed, hand-authored migration files (see ./migrations). The models
// here match what those migrations build; `snapshot.json` is their captured
// baseline, so `pylon db status` reports no uncaptured changes.
import {models} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

@models.model({table: 'shop_category'})
export class ShopCategory extends models.Model {
  id = models.ID()
  name = models.Text({unique: true})
  products = models.HasMany(() => ShopProduct, {foreignKey: 'categoryId'})
}

@models.model({table: 'shop_product'})
export class ShopProduct extends models.Model {
  id = models.ID()
  title = models.Text()
  categoryId = models.ForeignKey(() => ShopCategory)
  declare category: Relation<ShopCategory>
}

export const graphql = {
  Query: {},
  Mutation: {}
}
