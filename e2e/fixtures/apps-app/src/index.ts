// Multi-app Pylon host. Each app's `index.ts` inits its scope (models.app) and
// declares its models; the host just:
//  - composes the GraphQL schema by hand from each app's resolver exports, and
//  - mounts each app's Hono routes.
// Migration GROUPS are DERIVED from the `models.app(name)` tags in the registry
// (and ordered by inferred cross-app FKs) — there is no `apps` array to maintain.
import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'

// Importing the resolvers pulls in each app's index → registers its models.
import * as blog from './apps/blog/resolvers.js'
import * as shop from './apps/shop/resolvers.js'
import {registerBlogRoutes} from './apps/blog/routes.js'

export const graphql = {
  Query: {
    ...blog.Query,
    ...shop.Query
  },
  Mutation: {
    ...blog.Mutation,
    ...shop.Mutation
  }
}

registerBlogRoutes(app)

// Schema is provisioned out-of-band by `pylon db deploy` (per-app migrations).
serve({fetch: app.fetch, port: Number(process.env.PORT ?? 3000)}, info => {
  console.log(`ready:${info.port}`)
})
