// A GATED app: capability gate (the 'shop' role) on the Pylon via the gate()
// sugar, plus tenant-scoped models (orgId) — the two authz layers in one app.
import {Pylon} from '@getcronit/pylon'
import {getPrincipal, hasRole} from '@getcronit/pylon-auth'
import {db, gate, models} from '@getcronit/pylon-db'

const shop_ = models.app('shop', {tenant: 'orgId'}) // reads auto-scoped by orgId

@shop_.model() // → shop_product
export class Product extends shop_.Model {
  static objects = db.manager(Product)
  id = shop_.ID()
  orgId = shop_.Text()
  name = shop_.Text()
  price = shop_.Int()
}

export const shop = new Pylon({
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
