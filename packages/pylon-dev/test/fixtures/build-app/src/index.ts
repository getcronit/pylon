// A real ORM-backed Pylon entry, used by the e2e build test. Models extend
// Model (whose members are all excluded) so this also exercises the empty-
// interface path that broke a real build.
import {Model, model, id, text, int, boolean, hasMany, foreignKey} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'

@model()
export class Category extends Model {
  id = id()
  name = text({unique: true})
  products = hasMany(() => Product, {foreignKey: 'categoryId'})
}

@model()
export class Product extends Model {
  id = id()
  name = text({unique: true})
  price = int()
  inStock = boolean({default: true})
  categoryId = foreignKey(() => Category)
  declare category: Relation<Category>
  $secretCost = int({nullable: true})
}

export const graphql = {
  Query: {
    product: (): Product => ({}) as Product,
    products: (): Product[] => []
  },
  Mutation: {}
}
