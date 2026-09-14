// A GATED app: capability gate (the 'shop' role) on the Pylon via the gate()
// sugar, plus tenant-scoped models (orgId) — the two authz layers in one app.
import {Pylon} from '@getcronit/pylon'
import {getPrincipal, hasRole} from '@getcronit/pylon/auth'
import {db, gate, models} from '@getcronit/pylon/db'

// Decorator-free: a plain model class; the app names it (table prefix) + sets `tenant`.
export class Product extends models.Model {
  static objects = db.manager(Product)
  id = models.ID()
  orgId = models.Text()
  name = models.Text()
  price = models.Int()
}

export const shop = new Pylon({
  name: 'shop', // → table shop_product
  db: {models: [Product], tenant: 'orgId'}, // reads auto-scoped by orgId
  graphql: {
    Query: {
      // tenant auto-scoped: returns only the caller's org's products
      products: (): Promise<Product[]> => Product.objects.all()
    },
    Mutation: {
      addProduct: (name: string, price: number): Promise<Product> =>
        Product.objects.create({
          orgId: String(getPrincipal()?.tenant ?? ''),
          name,
          price
        })
    }
  },
  // CAPABILITY gate via the sugar — ForbiddenError unless the Principal has 'shop'.
  gate: gate({authorize: p => hasRole(p, 'shop')})
})
