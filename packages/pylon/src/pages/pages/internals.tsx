import {PylonQueryProvider} from '@getcronit/pylon/query'
import {createContext, useContext, useMemo} from 'react'
import {PageProps} from '.'
import {
  createTranslator,
  getMessageFormatter,
  type ArgsFor,
  type At,
  type Messages,
  type Paths
} from '../plugins/use-pages/catalog'
// Type-only, so the index → internals → index cycle is erased at runtime.
import type {Catalog} from '..'
import {
  createNoopResponseCookies,
  createResponseCookies,
  type ResponseCookies
} from './response-cookies'

/**
 * Serialize a value for safe embedding inside an inline `<script>` tag.
 *
 * `JSON.stringify` alone is unsafe here: the HTML parser terminates the script
 * block at the first literal `</script>` (or `<!--`) in the text, regardless of
 * JSON string quoting. We escape `<` as `<` (which parses back to `<`) plus
 * the U+2028/U+2029 line separators that are valid JSON but invalid in JS source.
 */
const serializeForScript = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

const dataClientContext = createContext<{
  client: any
  pagesContext?: any
  responseCookies?: ResponseCookies
  i18n?: any
  messages?: Record<string, unknown>
} | null>(null)

/** Browser singleton — nothing to write to, so one shared no-op is enough. */
const noopResponseCookies = createNoopResponseCookies()

/**
 * Provides the pylon-query client to `useData`/`usePaginatedData` (via
 * `PylonQueryProvider`) and, on the server, embeds the operation-keyed
 * hydration payload as `window.__pylon`.
 *
 * `client` may be the generated client module (`import * as client`) or a bare
 * `PylonQueryClient`; we unwrap `.client` either way. `staticData.cache` is the
 * flat `{ opKey: result }` map collected after the SSR prepass.
 */
const DataClientProvider: React.FC<{
  client: any
  staticData?: {
    cache?: Record<string, unknown>
    context?: any
    i18n?: any
    /** Server only: `{canonical, alternates}` for this page. */
    metadata?: {
      canonical?: string
      alternates: Array<{hreflang: string; href: string}>
    }
    /** The active locale's messages, already merged over the default locale's. */
    messages?: Record<string, unknown>
  }
  /** Server only: the per-request collector the SSR handler flushes after rendering. */
  responseCookies?: ResponseCookies
  children: React.ReactNode
}> = ({children, client, staticData, responseCookies}) => {
  // Server only: React 19 hoists <link> to <head> wherever it is rendered, so these ride the
  // existing provider instead of needing the app to place a component. Client-side they are
  // already in the document — re-rendering them would only risk a hydration mismatch.
  const metadata = typeof window === 'undefined' ? staticData?.metadata : undefined
  const isServer = typeof window === 'undefined'
  const coreClient = client?.client ?? client

  // Server: the prepass already populated this client's store, so we just embed
  // the collected snapshot for the browser. Client: hydration runs globally in
  // inject-app-hydration.ts before hydrateRoot.
  const cache = isServer ? staticData?.cache : undefined
  const pagesContext = isServer
    ? staticData?.context
    : (typeof window !== 'undefined' &&
        (window as any).__pylonStaticData?.context) ||
      undefined

  // Same channel as `context`: the client reads the SERVER's negotiated locale rather than
  // deriving its own from `navigator.language`. That is what makes hydration parity
  // structural — there is no second opinion for the client to hold.
  const i18n = isServer
    ? staticData?.i18n
    : (typeof window !== 'undefined' &&
        (window as any).__pylonStaticData?.i18n) ||
      undefined

  // Same channel again: the browser gets the ACTIVE locale's messages only, already merged
  // over the default on the server, so it needs neither fallback logic nor a second catalog.
  const messages = isServer
    ? staticData?.messages
    : (typeof window !== 'undefined' &&
        (window as any).__pylonStaticData?.messages) ||
      undefined

  // Server: the request's collector. Client: a no-op that warns — the hook is callable on
  // both sides so components need no `typeof window` guard.
  const cookies = isServer ? responseCookies : noopResponseCookies

  const contextValue = useMemo(
    () => ({client: coreClient, pagesContext, responseCookies: cookies, i18n, messages}),
    [coreClient, pagesContext, cookies, i18n, messages]
  )

  return (
    <PylonQueryProvider value={coreClient}>
      <dataClientContext.Provider value={contextValue}>
        {metadata && (
          <>
            {/* Each locale is its OWN canonical. Pointing a translated page at another
                language's URL is the classic way to make search engines drop it.
                Absent when the app took the canonical over — see `canonical` in
                `usePages`; React would append rather than replace ours. */}
            {metadata.canonical && <link rel="canonical" href={metadata.canonical} />}
            {/* The full cluster, identical on every locale — that is what makes it
                bidirectional and self-referential. One bad entry voids all of it. */}
            {metadata.alternates.map(a => (
              <link
                key={a.hreflang}
                rel="alternate"
                hrefLang={a.hreflang}
                href={a.href}
              />
            ))}
          </>
        )}
        {isServer && (cache || pagesContext || i18n || messages) && (
          <script
            dangerouslySetInnerHTML={{
              // Embed the SSR static data as a single envelope mirroring the
              // `staticData` prop: `{cache, context}`. `cache` seeds the
              // pylon-query store pre-hydration (inject-app-hydration.ts);
              // `context` (auth/features/role) feeds `useRouteData`. Without the
              // latter, `context` was undefined on hydration and feature-gated UI
              // rendered on the server flashed away on the client.
              __html: `window.__pylonStaticData = ${serializeForScript({
                ...(cache ? {cache} : {}),
                ...(pagesContext ? {context: pagesContext} : {}),
                ...(i18n ? {i18n} : {}),
                ...(messages ? {messages} : {})
              })};`
            }}
          />
        )}
        {children}
      </dataClientContext.Provider>
    </PylonQueryProvider>
  )
}

const useDataClient = () => {
  const context = useContext(dataClientContext)

  if (!context) {
    throw new Error('useDataClient must be used within a DataClientProvider')
  }

  return context
}

/**
 * Queue a cookie on the SSR response from inside a page or layout.
 *
 * ```tsx
 * const cookies = useResponseCookies()
 * if (!context.localeWasExplicit) {
 *   cookies.set('locale', context.locale, {path: '/', maxAge: 31536000, sameSite: 'Lax'})
 * }
 * ```
 *
 * Writes are keyed by cookie name and flushed once, after the render completes — so the
 * error path's second render overwrites rather than emitting a duplicate `Set-Cookie`.
 * Only safe for idempotent writes; see `response-cookies.ts` for the full contract.
 * In the browser this is a no-op that warns once.
 */
const useResponseCookies = (): ResponseCookies =>
  useDataClient().responseCookies ?? noopResponseCookies

/**
 * The locale this render is using, plus what negotiation decided about it.
 *
 * Identical on the server and in the browser — the client reads the server's result out of
 * the hydration envelope instead of consulting `navigator.language`, so the two cannot
 * disagree and there is no locale flash.
 *
 * Throws when `usePages({i18n})` is not configured, rather than inventing a default: a
 * silent `'en'` would look like it worked and mistranslate everything.
 */
const useLocale = (): {
  locale: string
  locales: readonly string[]
  defaultLocale: string
  localeWasExplicit: boolean
  suggestedLocale?: string
} => {
  const i18n = useDataClient().i18n
  if (!i18n) {
    throw new Error(
      '[pylon] useLocale() requires i18n to be configured: usePages({i18n: {locales, defaultLocale}}).'
    )
  }
  return i18n
}

/**
 * Translate messages for the active locale.
 *
 * ```tsx
 * const t = useTranslations('checkout')
 * t('total', {amount: '12.00', count: 3})
 * ```
 *
 * Keys and their placeholders are both checked, inferred from the app's default-locale
 * catalog via the `Catalog` interface — no codegen, and wrong keys or missing placeholders
 * are compile errors.
 *
 * The signature is written against the concrete `Catalog` on purpose: a generic
 * `Translate<T>` alias makes TypeScript evaluate `Paths<T>` for an unresolved `T` and fail
 * with "Type instantiation is excessively deep" at the declaration itself.
 */
/**
 * Keys BELOW a namespace, derived by filtering the full key space with a template literal.
 *
 * Deliberately not `Paths<At<Catalog, N>>`: handing `Paths` anything derived from a generic
 * parameter makes TypeScript evaluate it against an unresolved type and fail with "Type
 * instantiation is excessively deep" at the declaration, before an app calls it. Here `Paths`
 * only ever sees the concrete `Catalog`, and the generic does nothing but filter strings.
 */
type KeysIn<N extends string> = (Paths<Catalog> & string) extends infer P
  ? P extends `${N}.${infer Rest}`
    ? Rest
    : never
  : never

/** Every proper key prefix — `'checkout.total'` contributes `'checkout'`, `'a.b.c'` gives `'a' | 'a.b'`. */
type PrefixesOf<P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head | `${Head}.${PrefixesOf<Rest>}`
  : never

/**
 * Valid namespaces. Constrained to real prefixes rather than `string`, or
 * `useTranslations('nope')` would be accepted and every key under it would then resolve to
 * `never` — an error pointing at the key rather than at the namespace that caused it.
 */
type Namespace = PrefixesOf<Paths<Catalog> & string>

function useTranslations(): <K extends Paths<Catalog> & string>(
  key: K,
  ...args: ArgsFor<At<Catalog, K>>
) => string
function useTranslations<N extends Namespace>(
  namespace: N
): <K extends KeysIn<N> & string>(
  key: K,
  ...args: ArgsFor<At<Catalog, `${N}.${K}`>>
) => string
function useTranslations(namespace?: string): any {
  const messages = useDataClient().messages
  if (!messages) {
    throw new Error(
      '[pylon] useTranslations() requires message catalogs: ' +
        'usePages({i18n: {locales, defaultLocale, messages: {...}}}).'
    )
  }
  const {locale} = useLocale()
  // Module-level, so SSR and hydration use the SAME formatter (see setMessageFormatter).
  const formatMessage = getMessageFormatter()
  return useMemo(
    () => createTranslator(messages as Messages, {locale, namespace, formatMessage}),
    [messages, locale, namespace, formatMessage]
  )
}

/**
 * `Intl` formatters bound to the active locale.
 *
 * Constructing an `Intl.*Format` is expensive, so they are memoised per locale + options
 * rather than rebuilt on every render.
 */
const useFormatter = () => {
  const {locale} = useLocale()
  return useMemo(() => {
    const numberCache = new Map<string, Intl.NumberFormat>()
    const dateCache = new Map<string, Intl.DateTimeFormat>()
    const relativeCache = new Map<string, Intl.RelativeTimeFormat>()
    const memo = <T,>(cache: Map<string, T>, opts: unknown, make: () => T): T => {
      const key = JSON.stringify(opts ?? {})
      let v = cache.get(key)
      if (!v) {
        v = make()
        cache.set(key, v)
      }
      return v
    }
    return {
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        memo(numberCache, options, () => new Intl.NumberFormat(locale, options)).format(value),
      date: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
        memo(dateCache, options, () => new Intl.DateTimeFormat(locale, options)).format(value),
      relativeTime: (
        value: number,
        unit: Intl.RelativeTimeFormatUnit,
        options?: Intl.RelativeTimeFormatOptions
      ) =>
        memo(relativeCache, options, () =>
          new Intl.RelativeTimeFormat(locale, options)
        ).format(value, unit)
    }
  }, [locale])
}

export {
  DataClientProvider,
  useDataClient,
  useResponseCookies,
  createResponseCookies,
  useLocale,
  useTranslations,
  useFormatter
}

// ====================================================================
// 3. CORE CONTEXT AND PROVIDER
// ====================================================================

const RouteDataContext = createContext<{
  props: PageProps
  name?: string
} | null>(null)

/**
 * Provides the route data to components.
 */
const RouteDataProvider: React.FC<{
  children: React.ReactNode
  props: PageProps
  name?: string // Optional name property
}> = ({children, props, name}) => {
  const value = useMemo(() => ({props, name}), [props, name])

  return (
    <RouteDataContext.Provider value={value}>
      {children}
    </RouteDataContext.Provider>
  )
}

/**
 * Hook to access the route data for the current provider layer.
 */
const useRouteData = (): PageProps => {
  const context = useContext(RouteDataContext)

  if (!context) {
    throw new Error('useRouteData must be used within a RouteDataProvider')
  }

  return context.props
}

const useRouteId = (): string | undefined => {
  const context = useContext(RouteDataContext)
  return context?.name
}

// ====================================================================
// 4. THE REFRESH HOOK (The consumer)
// ====================================================================

export {RouteDataProvider, useRouteData, useRouteId}
