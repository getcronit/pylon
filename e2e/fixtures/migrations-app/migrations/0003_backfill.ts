// A TypeScript *code* migration (`run`) written against the ORM itself — NOT
// raw Kysely. During `pylon db migrate` the CLI calls `connect()`, which sets
// the ORM's default database; the manager resolves through that same default,
// so Active Record (`Model.create/get/$delete`) works inside a migration just
// like in app code. We read the seeded category by name, then create a product
// referencing it — logic the declarative SQL diff can't express. `down` removes
// it to stay reversible.
//
// Caveat (by design): this imports the *current* models. For migrations that
// must survive future schema changes, prefer runSql/raw DDL — a model-based
// data migration assumes today's model shape still matches the historical row.
import {migrations} from '@getcronit/pylon-db'
import {ShopCategory, ShopProduct} from '../src/index'

export default migrations.defineMigration({
  operations: [
    migrations.run({
      up: async () => {
        const books = await ShopCategory.get({name: 'Books'})
        await ShopProduct.create({title: 'Intro to Pylon', categoryId: books.id})
      },
      down: async () => {
        const product = await ShopProduct.get({title: 'Intro to Pylon'})
        await product.$delete()
      }
    })
  ]
})
