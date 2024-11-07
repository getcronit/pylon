import {app} from '@getcronit/pylon'

export const graphql = {
  Query: {
    hello: () => {
      return 'Hello, world!'
    }
  },
  Mutation: {}
}

Deno.serve(
  {
    port: 3000
  },
  app.fetch
)
