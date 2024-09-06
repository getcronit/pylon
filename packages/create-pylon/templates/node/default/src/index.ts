import {app} from '@getcronit/pylon'
import {serve} from '@hono/node-server'

export const graphql = {
  Query: {
    hello: () => {
      return 'Hello, world!'
    }
  },
  Mutation: {}
}

serve(app, info => {
  console.log(`Server running at ${info.port}`)
})
