// A data migration (`run`) using HISTORICAL models — the replay-safe, Django
// `apps.get_model()` equivalent. It does NOT import the live ShopCategory/
// ShopProduct classes; instead it asks the run context for the models as they
// existed at this point in the migration history (reconstructed from the named
// schema ops in 0001). So this migration keeps working — and a fresh-DB replay
// stays valid — even if those models are later renamed or deleted in the app.
//
// The row types are declared here for typing; the API is the usual `.objects`.
import {migrations} from '@getcronit/pylon-db'

interface CategoryRow {
  id: number
  name: string
}
interface ProductRow {
  id: number
  title: string
  categoryId: number
}

export default migrations.defineMigration({
  operations: [
    migrations.run({
      up: async ({models}) => {
        const Category = models.get<CategoryRow>('ShopCategory')
        const Product = models.get<ProductRow>('ShopProduct')
        const books = await Category.objects.get({name: 'Books'})
        await Product.objects.create({title: 'Intro to Pylon', categoryId: books.id})
      },
      down: async ({models}) => {
        const Product = models.get<ProductRow>('ShopProduct')
        await Product.objects.filter({title: 'Intro to Pylon'}).delete()
      }
    })
  ]
})
