// A named schema operation authored by hand: add a secondary index on
// shop_product.title. migrations.addIndex carries built-in reverse (down drops
// the index), so no manual `down` is needed — same ergonomics as Django's
// AddIndex / RemoveIndex.
import {migrations} from '@getcronit/pylon-db'

export default migrations.defineMigration({
  operations: [
    migrations.addIndex({
      name: 'shop_product_title_idx',
      table: 'shop_product',
      columns: ['title']
    })
  ]
})
