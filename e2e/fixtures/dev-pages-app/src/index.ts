import {Pylon} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Query: {ping: (): string => 'ok'},
    Mutation: {}
  }
})
