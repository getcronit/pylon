import {useNavigation} from 'react-router'

import {
  useDelayedFlag,
  useIsFetchingNow,
  type UseIsFetchingOptions
} from '@/query'

/**
 * Is the page busy — navigating, fetching, or both?
 *
 * The pages answer, and it is the OR of two signals that each miss half the
 * wait:
 *
 *   - `useNavigation()` reports the ROUTER's lifecycle. With no route loaders
 *     it finishes almost immediately, so on its own it flickers and is done
 *     before any data has been asked for. What it DOES cover is the part the
 *     query client cannot see: resolving the route and fetching its chunk.
 *
 *   - the query client reports operations in flight. That is the long part —
 *     the `useData` a page suspends on — and it does not start until the route
 *     has mounted.
 *
 * Either alone leaves a visible gap. Together they span from the click to the
 * new page being ready.
 *
 * Mount it in a LAYOUT rather than a page. When a route's `useData` throws,
 * React keeps the previous tree mounted until the promise settles, so an
 * indicator inside that subtree is frozen with it; a sibling of the route
 * re-renders on its own and can report the wait while the old page is still on
 * screen. That is also what makes this work for a page with no `<Suspense>` of
 * its own.
 */
export function useIsFetching(options?: UseIsFetchingOptions): boolean {
  const navigation = useNavigation()
  return useDelayedFlag(
    useIsFetchingNow() || navigation.state !== 'idle',
    options
  )
}
