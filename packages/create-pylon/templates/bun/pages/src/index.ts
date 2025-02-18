import {app, usePages, PylonConfig} from '@getcronit/pylon'

export const graphql = {
  Query: {
    hello: () => {
      return 'Hello, world!'
    }
  },
  Mutation: {}
}

export const config: PylonConfig = {
  plugins: [usePages()]
}

export default app
