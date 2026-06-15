// ORM-backed Pylon app using the capitalized `models.*` namespaced API.
import {Pylon} from '@getcronit/pylon'
import {models} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

@models.model()
export class Category extends models.Model {
  id = models.ID()
  name = models.Text({unique: true})
  products = models.HasMany(() => Product, {foreignKey: 'categoryId'})
}

@models.model()
export class Product extends models.Model {
  id = models.ID()
  name = models.Text({unique: true})
  price = models.Int()
  inStock = models.Boolean({default: true})
  categoryId = models.ForeignKey(() => Category)
  declare category: Relation<Category>
  $secretCost = models.Int({nullable: true})
}

export default new Pylon({
  graphql: {
    Query: {
      product: (): Product => ({}) as Product,
      products: (): Product[] => []
    },
    Mutation: {}
  }
})
