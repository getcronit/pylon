// shop app — inits its scope; Purchase has a CROSS-APP FK → blog.Author, so the
// migration system infers `shop` depends on `blog`.
import {Pylon} from '@getcronit/pylon'
import {models, db} from '@getcronit/pylon/db'
import type {Relation} from '@getcronit/pylon/db'
import {Author} from '../blog/index.js'

// Decorator-free plain models; the app names them (→ shop_*) + groups migrations.
export class Product extends models.Model {
  static objects = db.manager(Product)
  id = models.ID()
  title = models.Text()
  price = models.Int({min: 0})
}

export class Purchase extends models.Model {
  static objects = db.manager(Purchase)
  id = models.ID()
  productId = models.ForeignKey(() => Product)
  buyerId = models.ForeignKey(() => Author) // cross-app FK → blog_author
  declare product: Relation<Product>
  declare buyer: Relation<Author>
}

// The shop app — depends on blog (the cross-app FK Purchase.buyerId → blog_author).
// Zero-config: migrations default to src/apps/shop/migrations.
export const shop = new Pylon({name: 'shop', db: {models: [Product, Purchase]}})
