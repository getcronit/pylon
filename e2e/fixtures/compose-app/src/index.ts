// NEW model: two apps as Pylon instances (each with name-tagged ORM models),
// composed at the root into ONE schema. billing is gated (admin) — the gate is
// type-transparent, so its fields still appear in the introspected SDL. Proves
// the build type-introspects `default.graphql` across composed apps + merges
// each app's ORM models. No defineApp / compose() (pylon-app) / .resolvers.
import {Pylon} from '@getcronit/pylon'
import {hasRole} from '@getcronit/pylon-auth'
import {db, gate, models, type Relation} from '@getcronit/pylon-db'

// ---- catalog app (ungated) ----
export class Category extends models.Model {
  id = models.ID()
  name = models.Text({unique: true})
  products = models.HasMany(() => Product, {foreignKey: 'categoryId'})
}

export class Product extends models.Model {
  static objects = db.manager(Product)
  id = models.ID()
  name = models.Text()
  price = models.Int()
  categoryId = models.ForeignKey(() => Category)
  declare category: Relation<Category>
}

const catalog = new Pylon({
  name: 'catalog', // → catalog_category / catalog_product
  db: {models: [Category, Product]},
  graphql: {
    Query: {
      product: (): Product => ({}) as Product,
      products: (): Product[] => []
    },
    Mutation: {
      addProduct: (name: string, price: number): Product => ({name, price}) as Product
    }
  }
})

// ---- billing app (capability-gated: admin only) ----
export class Invoice extends models.Model {
  id = models.ID()
  total = models.Int()
}

const billing = new Pylon({
  name: 'billing', // → billing_invoice
  db: {models: [Invoice]},
  graphql: {
    Query: {
      invoice: (): Invoice => ({}) as Invoice
    },
    Mutation: {
      issueInvoice: (total: number): Invoice => ({total}) as Invoice
    }
  },
  gate: gate({authorize: p => hasRole(p, 'admin')})
})

export default new Pylon().compose(catalog, billing)
