import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'

export const graphql = {
  Query: {ping: (): string => 'ok'},
  Mutation: {}
}

serve({fetch: app.fetch, port: Number(process.env.PORT) || 3000}, info => {
  console.log(`ready:${info.port}`)
})
