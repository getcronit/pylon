// Multi-app Pylon host. Each app's `index.ts` inits its scope (models.app) and
// declares its models; the host composes the schema by hand from each app's
// resolver exports and mounts each app's Hono routes onto the Pylon instance.
import {Pylon} from '@getcronit/pylon'
import {getDatabase} from '@getcronit/pylon-db'

// Importing the resolvers pulls in each app's index → registers its models.
import * as blog from './apps/blog/resolvers.js'
import * as shop from './apps/shop/resolvers.js'
import * as notes from './apps/notes/resolvers.js'
import {registerBlogRoutes} from './apps/blog/routes.js'

const app = new Pylon({
  graphql: {
    Query: {
      ...blog.Query,
      ...shop.Query,
      ...notes.Query,
      // Debug-only: read the request DB's cumulative query counter (relation
      // batching proof). Not part of the real app surface.
      _dbQueryCount: (): number => getDatabase().queryCount
    },
    Mutation: {
      ...blog.Mutation,
      ...shop.Mutation,
      ...notes.Mutation,
      _dbQueryReset: (): boolean => {
        getDatabase().resetQueryCount()
        return true
      }
    }
  }
})

registerBlogRoutes(app)

// Schema is provisioned out-of-band by `pylon db deploy` (per-app migrations).
export default app
