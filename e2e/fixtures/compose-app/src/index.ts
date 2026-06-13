// pylon-app fixture: two `defineApp` apps fused with `compose()`. The point of
// this fixture is the BUILD — proving that `export const graphql =
// compose(...).graphql` is type-introspected by the real `pylon build` (the
// merged schema is the deep intersection of each app's resolver fragment), and
// that compose's gate-wrapping (the `billing` app's `authorize`) preserves the
// introspected field types (a gated field still appears with its real type).
import {compose, defineApp, hasRole} from '@getcronit/pylon-app'
import type {Relation} from '@getcronit/pylon-app'

// ---- catalog app (ungated) ----
const catalog = defineApp('catalog')

@catalog.model() // → catalog_category
export class Category extends catalog.Model {
  id = catalog.ID()
  name = catalog.Text({unique: true})
  products = catalog.HasMany(() => Product, {foreignKey: 'categoryId'})
}

@catalog.model() // → catalog_product
export class Product extends catalog.Model {
  id = catalog.ID()
  name = catalog.Text()
  price = catalog.Int()
  categoryId = catalog.ForeignKey(() => Category)
  declare category: Relation<Category>
}

const catalogApp = catalog.resolvers({
  Query: {
    product: (): Product => ({}) as Product,
    products: (): Product[] => []
  },
  Mutation: {
    addProduct: (name: string, price: number): Product => ({name, price}) as Product
  }
})

// ---- billing app (capability-gated: admin only) ----
const billing = defineApp('billing', {authorize: p => hasRole(p, 'admin')})

@billing.model() // → billing_invoice
export class Invoice extends billing.Model {
  id = billing.ID()
  total = billing.Int()
}

const billingApp = billing.resolvers({
  Query: {
    invoice: (): Invoice => ({}) as Invoice
  },
  Mutation: {
    issueInvoice: (total: number): Invoice => ({total}) as Invoice
  }
})

// The whole point: a composed, typed schema from two apps.
export const graphql = compose(catalogApp, billingApp).graphql
