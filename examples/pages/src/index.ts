import {app, usePages, PylonConfig} from '@getcronit/pylon'

export const graphql = {
  Query: {
    hello: () => {
      return 'Hello, world!22345689121'
    },
    someOtherHello: () => {
      return 'Hello, world!'
    },
    someOtherHello3: () => {
      return 'Hello, world2! Nicoo'
    }
  },
  Mutation: {}
}

export const config: PylonConfig = {
  plugins: [usePages()]
}

export default app
