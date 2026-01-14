import {createContext, useContext, useEffect, useRef} from 'react'
import {PageProps} from '.'

const dataClientContext = createContext<{
  client: any
} | null>(null)

const DataClientProvider: React.FC<{
  client: any
  children: React.ReactNode
}> = ({children, client}) => {
  return (
    <dataClientContext.Provider value={{client}}>
      {children}
    </dataClientContext.Provider>
  )
}

const useDataClient = () => {
  const context = useContext(dataClientContext)

  if (!context) {
    throw new Error('useDataClient must be used within a DataClientProvider')
  }

  return context.client
}

export {DataClientProvider, useDataClient}

// A simple alias for the refetch function type
type RefetchFunction = PageProps['data']['$refetch']

// ====================================================================
// 2. THE GLOBAL REGISTRY (The bridge)
// ====================================================================

/**
 * ⚠️ DANGER ZONE: This global Map serves as the central registry for named
 * RouteDataProviders. It MUST be managed meticulously with strict cleanup
 * inside useEffect to prevent memory leaks and stale references.
 */
const refetchRegistry = new Map<string, RefetchFunction>()

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
}> = ({children, props, name}) => {
  // Use a ref to ensure the $refetch function is stable for the effect dependencies.
  const refetchFnRef = useRef<RefetchFunction>(props.data.$refetch)
  refetchFnRef.current = props.data.$refetch

  useEffect(() => {
    // 1. REGISTRATION LOGIC
    if (name) {
      // Register the current refetch function
      refetchRegistry.set(name, refetchFnRef.current)

      // 2. CLEANUP LOGIC (Crucial for preventing memory leaks)
      return () => {
        // Unregister the function when the provider unmounts
        refetchRegistry.delete(name)
      }
    }
    // Dependency array ensures this runs only when 'name' changes or on mount/unmount.
    // We use the ref to prevent re-running if $refetch itself changes, but still
    // access the latest function via refetchFnRef.current.
  }, [name])

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

/**
 * Hook to trigger data refetching for the current layer and/or specified named layers.
 * Returns a function that accepts an optional array of provider names.
 */
const useRouteDataRefetch = (): ((names?: string[]) => Promise<void[]>) => {
  // Get the $refetch function for the currently mounted provider layer
  const currentRefetch = useRouteData().data.$refetch

  /**
   * Refreshes the data layer(s).
   * - The current data layer is ALWAYS refreshed.
   * - If 'names' are provided, those registered layers are also refreshed.
   * @param names An optional array of registered provider names to refresh.
   * @returns A Promise that resolves when all refetches are complete.
   */
  const pageRefresh = (names?: string[]): Promise<void[]> => {
    // 1. Start with the current context's refetch function
    const refetchesToCall: RefetchFunction[] = [currentRefetch]

    // 2. Add refetch functions for all requested named providers
    if (names && names.length > 0) {
      for (const name of names) {
        const namedRefetch = refetchRegistry.get(name)
        if (namedRefetch) {
          // Check to prevent double-calling if current name is in the list
          if (namedRefetch !== currentRefetch) {
            refetchesToCall.push(namedRefetch)
          }
        } else {
          // Best practice: warn the developer if a requested named provider isn't mounted
          console.warn(
            `usePageRefresh: No RouteDataProvider found currently mounted with name "${name}". Skipping refresh for this name.`
          )
        }
      }
    }

    // 3. Execute all collected refetch promises concurrently
    // We filter for unique functions just in case the current context was registered with a name
    const uniqueRefetches = Array.from(new Set(refetchesToCall))

    return Promise.all(uniqueRefetches.map(refetch => refetch()))
  }

  return pageRefresh
}

export {RouteDataProvider, useRouteData, useRouteDataRefetch}

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
