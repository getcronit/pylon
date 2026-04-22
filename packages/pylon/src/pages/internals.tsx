import {createContext, useContext} from 'react'
import {PageProps} from '.'

const dataClientContext = createContext<any | null>(null)

const DataClientProvider: React.FC<{
  client: any
  children: React.ReactNode
}> = ({children, client}) => {
  return (
    <dataClientContext.Provider value={client}>
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

const dataQueryContext = createContext<any | null>(null)

const DataQueryProvider: React.FC<{
  useQuery: any
  children: React.ReactNode
}> = ({children, useQuery}) => {
  return (
    <dataQueryContext.Provider value={useQuery}>
      {children}
    </dataQueryContext.Provider>
  )
}

const useDataQuery = () => {
  const query = useContext(dataQueryContext)

  if (query) {
    return query
  }

  const client = useDataClient()

  return client.useQuery
}

export {DataClientProvider, DataQueryProvider, useDataClient, useDataQuery}

// A simple alias for the refetch function type
type RefetchFunction = (ignoreCache?: boolean) => Promise<any>

// ====================================================================
// 2. THE GLOBAL REGISTRY (The bridge)
// ====================================================================

/**
 * ⚠️ DANGER ZONE: This global Map serves as the central registry for named
 * RouteDataProviders and individual useData hooks. It MUST be managed meticulously
 * with strict cleanup inside useEffect to prevent memory leaks and stale references.
 */
export const refetchRegistry = new Map<string, Set<RefetchFunction>>()

export const registerRefetch = (name: string, fn: RefetchFunction) => {
  let set = refetchRegistry.get(name)
  if (!set) {
    set = new Set()
    refetchRegistry.set(name, set)
  }
  set.add(fn)
}

export const unregisterRefetch = (name: string, fn: RefetchFunction) => {
  const set = refetchRegistry.get(name)
  if (set) {
    set.delete(fn)
    if (set.size === 0) {
      refetchRegistry.delete(name)
    }
  }
}

// ====================================================================
// 3. CORE CONTEXT AND PROVIDER
// ====================================================================

const RouteDataContext = createContext<PageProps | null>(null)

/**
 * Provides the route data to components. If a 'name' is provided, it
 * registers the $refetch function in the global registry for remote calls.
 */
const RouteDataProvider: React.FC<{
  children: React.ReactNode
  props: PageProps
  name?: string // Optional name property
}> = ({children, props}) => {
  return (
    <RouteDataContext.Provider value={props}>
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

  return context
}

// ====================================================================
// 4. THE REFRESH HOOK (The consumer)
// ====================================================================

export {RouteDataProvider, useRouteData}

// ====================================================================
// 5. SSR PRUNING (Selective Rendering)
// ====================================================================

const SSRPruningContext = createContext<string | null>(null)

/**
 * Provider to signal which layout should be the "pruning target" during SSR.
 * Components matching this target will skip rendering their children.
 */
export const SSRPruningProvider: React.FC<{
  target: string | null
  children: React.ReactNode
}> = ({children, target}) => {
  return (
    <SSRPruningContext.Provider value={target}>
      {children}
    </SSRPruningContext.Provider>
  )
}

/**
 * Hook to consume the SSR pruning target.
 */
export const useSSRPruning = () => {
  return useContext(SSRPruningContext)
}
