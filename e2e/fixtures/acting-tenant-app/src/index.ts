// Acting-as-tenant fixture: ONE tenant-scoped model reused by every ordinary resolver.
// A privileged principal runs a SINGLE operation as another org by carrying
// `@inContext(context: { actingTenant })`; the gate + rebind live in pylon.config.ts. No
// parallel `unscoped()` admin API — the same `products` resolver serves the acted org.
import {Pylon} from '@getcronit/pylon'
import {currentTenant, db, models} from '@getcronit/pylon/db'

// A plain tenant-scoped model: reads auto-filter by `orgId = currentTenant()`, and
// `currentTenant()` is whatever the operation is bound to — the viewer's own org, or the
// acted org when a SUPER_ADMIN acts.
export class Product extends models.Model {
  static objects = db.manager(Product)
  id = models.ID()
  orgId = models.Text()
  name = models.Text()
  price = models.Int()
}

export default new Pylon({
  name: 'acting', // → table acting_product
  db: {models: [Product], tenant: 'orgId'},
  graphql: {
    Query: {
      // Tenant auto-scoped: only the ACTIVE tenant's rows. No acting → own org; acting →
      // the acted org — the whole point is that this resolver needs no change.
      products: (): Promise<Product[]> => Product.objects.all(),
      // The tenant actually bound for THIS operation — proves the per-operation rebind, and
      // that it does NOT leak into the next operation.
      activeTenant: (): string => String(currentTenant() ?? '(none)')
    },
    Mutation: {
      // Writes into the ACTIVE tenant, so an acting SUPER_ADMIN's create lands in the acted
      // org (ambient tenantId — the same create path every tenant uses).
      addProduct: (name: string, price: number): Promise<Product> =>
        Product.objects.create({
          orgId: String(currentTenant() ?? ''),
          name,
          price
        })
    }
  }
})
