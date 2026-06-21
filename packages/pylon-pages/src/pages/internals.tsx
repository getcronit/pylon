import {PylonQueryProvider} from '@getcronit/pylon-query'
import {createContext, useContext, useMemo} from 'react'
import {PageProps} from '.'

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
} | null>(null)

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
  }
  children: React.ReactNode
}> = ({children, client, staticData}) => {
  const isServer = typeof window === 'undefined'
  const coreClient = client?.client ?? client

  // Server: the prepass already populated this client's store, so we just embed
  // the collected snapshot for the browser. Client: hydration runs globally in
  // inject-app-hydration.ts before hydrateRoot.
  const cache = isServer ? staticData?.cache : undefined
  const pagesContext = isServer
    ? staticData?.context
    : (typeof window !== 'undefined' && (window as any).__pylonContext) ||
      undefined

  const contextValue = useMemo(
    () => ({client: coreClient, pagesContext}),
    [coreClient, pagesContext]
  )

  return (
    <PylonQueryProvider value={coreClient}>
      <dataClientContext.Provider value={contextValue}>
        {isServer && cache && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.__pylon = ${serializeForScript(cache)}`
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

export {DataClientProvider, useDataClient}

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
