import {useEffect, useRef, useState, useSyncExternalStore} from 'react'

import {usePylonQueryClient} from './context'

export interface UseIsFetchingOptions {
  /**
   * Wait this long before reporting `true`.
   *
   * Most navigations resolve from cache or in a few tens of milliseconds, and a
   * bar that flashes on every click is worse than no bar at all. Only a wait
   * long enough to notice is worth reporting.
   */
  delay?: number
  /**
   * Once reported, stay `true` for at least this long.
   *
   * Without it a fetch that lands just past `delay` produces a one-frame
   * flicker — the thing the delay was meant to prevent, moved.
   */
  minDuration?: number
}

/**
 * Is anything being fetched right now?
 *
 * For the indicator a suspending page cannot show itself. When a route's
 * `useData` throws, React keeps the previous tree mounted until the promise
 * settles, so a spinner INSIDE that subtree is frozen along with it. Mounted in
 * a layout — a sibling of the route, not a child — this re-renders on its own
 * and can report the wait while the old page is still on screen.
 *
 * Covers cross-route navigation, a variables change on the same route, and
 * background revalidation alike, because all three are the same event to the
 * store: an operation acquiring an in-flight promise.
 */
export function useIsFetching(options?: UseIsFetchingOptions): boolean {
  return useDelayedFlag(useIsFetchingNow(), options)
}

/**
 * The raw signal: is an operation in flight THIS instant, no smoothing.
 *
 * Exported for composition. The pages layer ORs it with the router's own
 * navigation state — a click resolves a route and may fetch its chunk before
 * any query starts, and that wait is part of what the visitor is waiting for.
 * That OR belongs there and not here: this package is a GraphQL client and
 * knows nothing about routing.
 */
export function useIsFetchingNow(): boolean {
  const client = usePylonQueryClient()

  return useSyncExternalStore(
    client.store.subscribe,
    client.store.isFetching,
    // Never true on the server: the SSR pass resolves its data before it
    // renders, and reporting a wait into static HTML would ship a bar that
    // hydration then has to take away.
    () => false
  )
}

/**
 * Smooth a raw busy flag into one worth rendering.
 *
 * Shared by the query-only hook and the pages one so both wait and linger by
 * the same rules — an indicator that behaved differently depending on which
 * import you reached for would be its own bug.
 */
export function useDelayedFlag(
  raw: boolean,
  options?: UseIsFetchingOptions
): boolean {
  const {delay = 150, minDuration = 300} = options ?? {}
  const fetching = raw
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (fetching) {
      if (shown) return
      const id = setTimeout(() => {
        shownAt.current = Date.now()
        setShown(true)
      }, delay)
      return () => clearTimeout(id)
    }

    if (!shown) return
    const held = Date.now() - shownAt.current
    if (held >= minDuration) {
      setShown(false)
      return
    }
    const id = setTimeout(() => setShown(false), minDuration - held)
    return () => clearTimeout(id)
  }, [fetching, shown, delay, minDuration])

  return shown
}
