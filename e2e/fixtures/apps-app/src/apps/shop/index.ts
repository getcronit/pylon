// shop app — inits its scope; Purchase has a CROSS-APP FK → blog.Author, so the
// migration system infers `shop` depends on `blog`.
import {models, db} from '@getcronit/pylon-db'
import type {Relation} from '@getcronit/pylon-db'
import {Author} from '../blog/index.js'

export const shop = models.app('shop')

@shop.model() // → table "shop_product"
export class Product extends shop.Model {
  static objects = db.manager(Product)
  id = shop.ID()
  title = shop.Text()
  price = shop.Int({min: 0})
}

@shop.model() // → table "shop_purchase"
export class Purchase extends shop.Model {
  static objects = db.manager(Purchase)
  id = shop.ID()
  productId = shop.ForeignKey(() => Product)
  buyerId = shop.ForeignKey(() => Author) // cross-app FK → blog_author
  declare product: Relation<Product>
  declare buyer: Relation<Author>
}
