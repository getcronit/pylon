import {op, type MetadataRoute} from '@getcronit/pylon/pages'

// The sitemap fetches its URLs from the app's OWN GraphQL API. `op.query` runs the
// compiled operation against the in-process schema (no network hop), the same
// imperative client pages use in the browser — here bound request-scoped on the
// server by the pages runtime. The root may be destructured (`({products}) => …`)
// or taken whole (`q => q.products(…)`); both compile.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await op.query(({products}) =>
    products({first: 100}).nodes.map(p => ({
      handle: p.handle,
      updatedAt: p.updatedAt
    }))
  )

  return [
    {url: '/', changefreq: 'daily', priority: 1},
    ...products.map(p => ({
      url: `/products/${p.handle}`,
      lastmod: p.updatedAt
    }))
  ]
}
