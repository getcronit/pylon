import {app} from '@getcronit/pylon'

export const graphql = {
  Query: {
    hello: () => {
      return 'Hello, world!'
    }
  },
  Mutation: {}
}

export default app
