import {createContext, useContext, useEffect, useMemo} from 'react'
import {PageProps} from '.'

const dataClientContext = createContext<{
  client: any
  pagesContext?: any
} | null>(null)

const DataClientProvider: React.FC<{
  client: any
  staticData?: {
    cache?: any
    context?: any
  }
  children: React.ReactNode
}> = ({children, client, staticData}) => {
  const isServer = typeof window === 'undefined'

  useEffect(() => {
    console.log('DataClientProvider mounted')
    return () => {
      console.log('DataClientProvider unmounted')
    }
  }, [])

  // Hydrate the cache and context on the client.
  const payload = useMemo(() => {
    if (typeof window !== 'undefined') {
      return (window as any).__pylonStaticData
    }
    return staticData
  }, [staticData])

  // On the server, we hydrate the cache if a snapshot is provided (e.g. from a prerender pass)
  // On the client, hydration is handled globally in inject-app-hydration.ts
  const coreClient = client.client || client
  if (isServer && payload?.cache && coreClient && coreClient.cache) {
    coreClient.cache.restore(payload.cache)
  }

  const pagesContext = payload?.context

  const contextValue = useMemo(() => {
    return {
      client,
      pagesContext
    }
  }, [client, pagesContext])

  return (
    <dataClientContext.Provider value={contextValue}>
      {isServer && payload && (
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__pylonStaticData = ${JSON.stringify(payload)}`
          }}
        />
      )}
      {children}
    </dataClientContext.Provider>
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
