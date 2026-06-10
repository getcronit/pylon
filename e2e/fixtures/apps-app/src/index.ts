// Multi-app Pylon host. Two modular apps (blog + shop) compose into ONE schema:
//  - their models register globally (→ entities + per-app migrations), and
//  - their resolver fragments are spread into the single introspected `graphql`.
import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'
import {blog} from './apps/blog/app.js'
import {shop} from './apps/shop/app.js'

// INSTALLED_APPS — drives per-app migrations (`pylon db diff --app …`, deploy
// applies them in dependency order). Read by the migration CLI via the loader.
export const apps = [blog, shop]

// Compose each app's resolver fragment. TS infers the merged type, so the
// type-introspection build sees every app's queries/mutations in one schema.
export const graphql = {
  Query: {
    ...blog.graphql.Query,
    ...shop.graphql.Query
  },
  Mutation: {
    ...blog.graphql.Mutation,
    ...shop.graphql.Mutation
  }
}

// Schema is provisioned out-of-band by `pylon db deploy` (per-app migrations).
serve({fetch: app.fetch, port: Number(process.env.PORT ?? 3000)}, info => {
  console.log(`ready:${info.port}`)
})
