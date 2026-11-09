import {Pylon} from '@getcronit/pylon'

// A tiny storefront schema. The point of the fixture is the SITEMAP fetching these
// products from the app's own GraphQL API in-process via `op` — see pages/sitemap.ts.
class Product {
  handle!: string
  updatedAt!: string
}

class ProductConnection {
  nodes!: Product[]
  totalCount!: number
}

const PRODUCTS: Product[] = ['alpha', 'beta', 'gamma'].map((handle, i) =>
  Object.assign(new Product(), {handle, updatedAt: `2026-0${i + 1}-01`})
)

export default new Pylon({
  graphql: {
    Query: {
      // Positional args compile to `products(first: $v0, skip: $v1)`, mirroring the
      // shape a real storefront's sitemap paginates over.
      products: (first?: number, skip?: number): ProductConnection => {
        const start = skip ?? 0
        const slice = PRODUCTS.slice(
          start,
          first != null ? start + first : undefined
        )
        return Object.assign(new ProductConnection(), {
          nodes: slice,
          totalCount: PRODUCTS.length
        })
      }
    },
    Mutation: {}
  }
})
