// Host entry: the composed schema is the GraphQL export; routes + Context come
// from useApp (pylon.config.ts). Mirrors a real pylon-app service.
import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'
import {composed} from './apps'

export const graphql = composed.graphql

serve({fetch: app.fetch, port: Number(process.env.PORT ?? 3000)}, info => {
  console.log(`ready:${info.port}`)
})
