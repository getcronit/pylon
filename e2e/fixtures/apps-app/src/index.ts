// Multi-app Pylon host. Two modular apps (blog + shop) compose into ONE schema:
//  - their models register globally (→ entities + per-app migrations), and
//  - their resolver fragments are spread into the single introspected `graphql`.
import {app, createApp} from '@getcronit/pylon'
import {serve} from '@hono/node-server'
import {blog} from './apps/blog/app.js'
import {shop} from './apps/shop/app.js'

// INSTALLED_APPS — drives per-app migrations (`pylon db diff --app …`, deploy
// applies them in dependency order). Read by the migration CLI via the loader.
export const apps = [blog, shop]

// Compose the apps: merges each fragment into the single introspected `graphql`
// (typed, so the build sees every app's ops) and mounts each app's Hono routes.
export const graphql = createApp(apps)

// Schema is provisioned out-of-band by `pylon db deploy` (per-app migrations).
serve({fetch: app.fetch, port: Number(process.env.PORT ?? 3000)}, info => {
  console.log(`ready:${info.port}`)
})
