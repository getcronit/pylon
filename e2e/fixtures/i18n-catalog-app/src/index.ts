import {getLocale, Pylon} from '@getcronit/pylon'
export default new Pylon({graphql: {
    Query: {
      ping: (): string => 'ok',
      // Translated by the RESOLVER, from @inContext — not from the client catalog.
      serverGreeting: (): string =>
        ({en: 'Server: hello', de: 'Server: hallo', fr: 'Server: bonjour'})[
          getLocale() ?? 'en'
        ] ?? 'Server: hello'
    },
    Mutation: {}
  }})
