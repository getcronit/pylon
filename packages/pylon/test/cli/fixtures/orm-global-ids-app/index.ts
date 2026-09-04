// An ORM-backed entry that opts into global ids via the top-level `node` option.
import {Pylon} from '@getcronit/pylon'
import {Model, id, text} from '@getcronit/pylon/db'

export class Product extends Model {
  id = id()
  name = text({unique: true})
}

export class Category extends Model {
  id = id()
  label = text()
}

export default new Pylon({
  db: {models: [Product, Category]},
  node: true,
  graphql: {
    Query: {
      // A user-defined root field — must survive the Node `Query.node` injection.
      product: (): Product => ({}) as Product
    }
  }
})
