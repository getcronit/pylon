// NEW model: two apps as Pylon instances (each with name-tagged ORM models),
// composed at the root into ONE schema. billing is gated (admin) — the gate is
// type-transparent, so its fields still appear in the introspected SDL. Proves
// the build type-introspects `default.graphql` across composed apps + merges
// each app's ORM models. No defineApp / compose() (pylon-app) / .resolvers.
import {Pylon} from '@getcronit/pylon'
import {hasRole} from '@getcronit/pylon-auth'
import {db, gate, models, type Relation} from '@getcronit/pylon-db'

// ---- catalog app (ungated) ----
const catalog_ = models.app('catalog')

@catalog_.model() // → catalog_category
export class Category extends catalog_.Model {
  id = catalog_.ID()
  name = catalog_.Text({unique: true})
  products = catalog_.HasMany(() => Product, {foreignKey: 'categoryId'})
}

@catalog_.model() // → catalog_product
export class Product extends catalog_.Model {
  static objects = db.manager(Product)
  id = catalog_.ID()
  name = catalog_.Text()
  price = catalog_.Int()
  categoryId = catalog_.ForeignKey(() => Category)
  declare category: Relation<Category>
}

const catalog = new Pylon({
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
const billing_ = models.app('billing')

@billing_.model() // → billing_invoice
export class Invoice extends billing_.Model {
  id = billing_.ID()
  total = billing_.Int()
}

const billing = new Pylon({
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
