// A real ORM-backed Pylon entry built by the shipped `pylon` CLI in the e2e
// test. Models extend Model (all members excluded), exercising the empty-
// interface path; a $-prefixed column exercises ORM-driven hiding.
import {Model, model, id, text, int, boolean, hasMany, foreignKey} from '@getcronit/pylon-orm'
import type {Relation} from '@getcronit/pylon-orm'

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
