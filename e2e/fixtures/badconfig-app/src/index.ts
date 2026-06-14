// Minimal app whose pylon.config throws at load — used to prove `pylon build`
// FAILS LOUD (non-zero exit) instead of silently booting with zero plugins.
export const graphql = {
  Query: {hello: (): string => 'world'},
  Mutation: {}
}
