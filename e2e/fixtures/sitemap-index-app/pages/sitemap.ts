import {op, type MetadataRoute} from '@getcronit/pylon/pages'

// A SHARDED sitemap: `/sitemap.xml` is an index pointing at each shard, and
// `/sitemap/:id.xml` renders one shard. The `products` shard fetches its URLs from
// the app's own GraphQL via server-side `op`; the `static` shard is plain.
export async function generateSitemaps() {
  return [{id: 'products'}, {id: 'static'}]
}

export default async function sitemap({
  id
}: {
  id: string
}): Promise<MetadataRoute.Sitemap> {
  if (id === 'products') {
    const products = await op.query(({products}) =>
      products({first: 100}).nodes.map(p => ({
        handle: p.handle,
        updatedAt: p.updatedAt
      }))
    )
    return products.map(p => ({url: `/products/${p.handle}`, lastmod: p.updatedAt}))
  }

  return [
    {url: '/', changefreq: 'daily', priority: 1},
    {url: '/pricing'}
  ]
}
