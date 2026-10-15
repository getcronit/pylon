import {Pylon} from '@getcronit/pylon'

// Same tiny storefront as sitemap-data-app; here the sitemap is SHARDED behind an
// index, so the shard fetches products via server-side `op`.
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
