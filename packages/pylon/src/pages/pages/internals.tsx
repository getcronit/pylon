import {PylonQueryProvider} from '@getcronit/pylon/query'
import {createContext, useContext, useMemo} from 'react'
import {PageProps} from '.'
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
      canonical: string
      alternates: Array<{hreflang: string; href: string}>
    }
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

  // Server: the request's collector. Client: a no-op that warns — the hook is callable on
  // both sides so components need no `typeof window` guard.
  const cookies = isServer ? responseCookies : noopResponseCookies

  const contextValue = useMemo(
    () => ({client: coreClient, pagesContext, responseCookies: cookies, i18n}),
    [coreClient, pagesContext, cookies, i18n]
  )

  return (
    <PylonQueryProvider value={coreClient}>
      <dataClientContext.Provider value={contextValue}>
        {metadata && (
          <>
            {/* Each locale is its OWN canonical. Pointing a translated page at another
                language's URL is the classic way to make search engines drop it. */}
            <link rel="canonical" href={metadata.canonical} />
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
        {isServer && (cache || pagesContext || i18n) && (
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
                ...(i18n ? {i18n} : {})
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

export {
  DataClientProvider,
  useDataClient,
  useResponseCookies,
  createResponseCookies,
  useLocale
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
