import {getLocale, Pylon} from '@getcronit/pylon'

const catalog: Record<string, Record<string, string>> = {
  en: {greeting: 'Hello'},
  de: {greeting: 'Hallo'},
  fr: {greeting: 'Bonjour'}
}

export default new Pylon({
  graphql: {
    Query: {
      // The locale comes from the operation's @inContext, not from a header.
      greeting: (): string => {
        const locale = getLocale()
        return (locale && catalog[locale]?.greeting) ?? catalog.en.greeting
      },
      // Proves `undefined` is distinguishable from a default.
      localeOrNone: (): string => getLocale() ?? '(none)'
    },
    Mutation: {}
  }
})
