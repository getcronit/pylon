// Minimal app whose pylon.config throws at load — used to prove `pylon build`
// FAILS LOUD (non-zero exit) instead of silently booting with zero plugins.
import {Pylon} from '@getcronit/pylon'

export default new Pylon({
  graphql: {
    Query: {hello: (): string => 'world'},
    Mutation: {}
  }
})
