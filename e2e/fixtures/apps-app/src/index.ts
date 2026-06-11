// Multi-app Pylon host. Each app's `index.ts` inits its scope (models.app) and
// declares its models; the host just:
//  - composes the GraphQL schema by hand from each app's resolver exports, and
//  - mounts each app's Hono routes.
// Migration GROUPS are DERIVED from the `models.app(name)` tags in the registry
// (and ordered by inferred cross-app FKs) — there is no `apps` array to maintain.
import {app} from '@getcronit/pylon'
import {getDatabase} from '@getcronit/pylon-db'
import {serve} from '@hono/node-server'

// Importing the resolvers pulls in each app's index → registers its models.
import * as blog from './apps/blog/resolvers.js'
import * as shop from './apps/shop/resolvers.js'
import * as notes from './apps/notes/resolvers.js'
import {registerBlogRoutes} from './apps/blog/routes.js'

export const graphql = {
  Query: {
    ...blog.Query,
    ...shop.Query,
    ...notes.Query,
    // Debug-only: read the request DB's cumulative query counter so an e2e can
    // prove a deeply nested query resolves in O(depth) round-trips (relation
    // batching), not O(rows). Not part of the real app surface.
    _dbQueryCount: (): number => getDatabase().queryCount
  },
  Mutation: {
    ...blog.Mutation,
    ...shop.Mutation,
    ...notes.Mutation,
    // Debug-only: zero the counter right before a measured query.
    _dbQueryReset: (): boolean => {
      getDatabase().resetQueryCount()
      return true
    }
  }
}

registerBlogRoutes(app)

// Schema is provisioned out-of-band by `pylon db deploy` (per-app migrations).
serve({fetch: app.fetch, port: Number(process.env.PORT ?? 3000)}, info => {
  console.log(`ready:${info.port}`)
})
