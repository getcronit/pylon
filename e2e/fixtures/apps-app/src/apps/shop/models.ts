// shop app — models. Purchase has a CROSS-APP FK → blog.Author (the buyer).
import {models, db} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'
import {Author} from '../blog/models.js'

@models.model({table: 'shop_product'})
export class Product extends models.Model {
  static objects = db.manager(Product)
  id = models.ID()
  title = models.Text()
  price = models.Int({min: 0})
}

@models.model({table: 'shop_purchase'})
export class Purchase extends models.Model {
  static objects = db.manager(Purchase)
  id = models.ID()
  productId = models.ForeignKey(() => Product)
  buyerId = models.ForeignKey(() => Author) // cross-app FK → blog_author
  declare product: Relation<Product>
  declare buyer: Relation<Author>
}
