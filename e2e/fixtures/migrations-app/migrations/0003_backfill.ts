// A data migration (`run`) that uses the ORM — the `migrate` command connects
// the ORM's default database first, so `Model.objects.*` works here exactly as
// in app code. Logic the declarative diff can't express: read the seeded
// category by name, then create a product referencing it. `down` removes it.
//
// Note: this imports the live models, so it assumes their current shape — fine
// for a young schema, but for migrations that must survive future model changes
// prefer raw `runSql`.
import {migrations} from '@getcronit/pylon-db'
import {ShopCategory, ShopProduct} from '../src/index'

export default migrations.defineMigration({
  operations: [
    migrations.run({
      up: async () => {
        const books = await ShopCategory.objects.get({name: 'Books'})
        await ShopProduct.objects.create({title: 'Intro to Pylon', categoryId: books.id})
      },
      down: async () => {
        const product = await ShopProduct.objects.get({title: 'Intro to Pylon'})
        await product.$delete()
      }
    })
  ]
})
