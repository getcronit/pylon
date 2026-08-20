/**
 * `@inContext` — request context declared IN the query document.
 *
 * ```graphql
 * query Products($__locale: String) @inContext(locale: $__locale) {
 *   products { name }
 * }
 * ```
 *
 * A resolver then reads it:
 *
 * ```ts
 * Query: {
 *   greeting: (): string => translations[getLocale() ?? 'en'] ?? translations.en
 * }
 * ```
 *
 * ## Why a directive and not a header
 *
 * The obvious design is to forward the locale as an HTTP header and read it off the
 * request. It is wrong for a client that caches. `pylon-query` keys its store on
 * `documentId ~ variablesHash(variables)` and nothing else, so two requests for the same
 * document with the same variables ARE the same entry — English and German results would
 * collide on one key, in the client store and in the hydration envelope alike. Silent
 * cross-locale data bleed.
 *
 * Putting the context in the document makes that impossible: the locale arrives as a
 * variable, so it is part of the cache key by construction. Shopify's Storefront API reached
 * the same conclusion with the same directive name.
 *
 * A variable rather than a literal argument, so one compiled document serves every locale —
 * with `@inContext(locale: "de")` baked in, each locale would need its own document id.
 */
import {getContext} from './context.js'

/** SDL for the directive. Appended to the emitted schema whenever the app has resolvers. */
export const IN_CONTEXT_SDL = `directive @inContext(
  """The locale for this operation, e.g. \`en\` or \`de-AT\`."""
  locale: String
) on QUERY | MUTATION | SUBSCRIPTION`

/** Hono context key holding the operation's resolved context. */
export const IN_CONTEXT_KEY = 'pylonInContext'

export interface InContext {
  locale?: string
}

/**
 * The locale this operation asked for, or `undefined` when it asked for none.
 *
 * `undefined` is meaningful and should not be papered over with a default: it means the
 * caller did not state a locale, so a resolver should serve whatever it considers neutral
 * rather than guess.
 */
export const getLocale = (): string | undefined => getInContext().locale

/** Everything `@inContext` carried for this operation. */
export const getInContext = (): InContext => {
  try {
    return (getContext().get(IN_CONTEXT_KEY as never) as InContext) ?? {}
  } catch {
    // Outside a request (a script, a queue worker) there is no context to read.
    return {}
  }
}
