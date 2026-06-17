import type {UseQueryOptions} from '@gqty/react'
import mitt from 'mitt'
import {useEffect} from 'react'
import type {Data} from './index'
import {useDataClient} from './internals'

// 1. Define your events and initialize the mitt emitter
type Events = {
  refetch: string[]
}

const emitter = mitt<Events>()

interface UseDataOptions extends Omit<
  UseQueryOptions<any>,
  'prepare' | 'suspense'
> {
  tags?: string[]
  /**
   * By default, this page will use pylon's build time query analysis to fetch the data.
   * This improves the runtime performance and allows you to use conditional logic,
   * such as if-conditions, in your data fetching logic.
   * Set this to false to disable this feature.
   */
  disableBuildTimeGeneration?: boolean
}

export const useData = (options?: UseDataOptions) => {
  const dataClient = useDataClient()
  const useQuery = dataClient.client.useQuery

  // `prepare` is the build-injected selection pre-pass — a pure OPTIMIZATION: gqty
  // re-registers the very same selections when the component reads `data.x` during
  // render. So if it throws a ReferenceError — a selection referenced a variable
  // declared AFTER this useData() call (its temporal dead zone, since the build
  // injects `prepare` at the call site but it can read later-declared locals) — skip
  // it instead of crashing the whole page; the data still resolves lazily. Surface a
  // clear, actionable hint in dev. Any other error is a real bug → rethrow.
  const buildTimePrepare = options?.disableBuildTimeGeneration
    ? undefined
    : (options as {prepare?: (ctx: unknown) => void} | undefined)?.prepare
  const prepare =
    typeof buildTimePrepare === 'function'
      ? (ctx: unknown) => {
          try {
            return buildTimePrepare(ctx)
          } catch (e) {
            if (e instanceof ReferenceError) {
              if (process.env.NODE_ENV !== 'production') {
                console.warn(
                  `[pylon-pages] useData(): build-time prepare skipped — ${e.message}. ` +
                    `A variable used in a data selection is declared after this useData() ` +
                    `call (temporal dead zone). Move useData() below those variables to ` +
                    `restore SSR pre-fetch; data still loads lazily for now.`
                )
              }
              return
            }
            throw e
          }
        }
      : undefined

  // Assuming your gqty Data proxy exposes $refetch
  const data = useQuery({
    ...options,
    prepare,
    operationName: undefined,
    suspense: true
  }) as Data & {$refetch: () => void}

  // 2. Set up the listener inside a useEffect
  useEffect(() => {
    const handleRefetch = (refetchTags: string[]) => {
      // If the hook has no tags, we can ignore the refetch request
      if (!options?.tags || options.tags.length === 0) return

      // Check if there is an intersection between the emitted tags and this hook's tags
      const shouldRefetch = options.tags.some(tag => refetchTags.includes(tag))

      if (shouldRefetch && typeof data.$refetch === 'function') {
        data.$refetch()
      }
    }

    // Subscribe to the event
    emitter.on('refetch', handleRefetch)

    // Cleanup the subscription on unmount
    return () => {
      emitter.off('refetch', handleRefetch)
    }
    // We stringify the tags array so the effect doesn't re-run infinitely
    // if options.tags is passed as an inline array like `tags={['user']}`
  }, [options?.tags?.join(','), data])

  return data
}

// 3. Emit the event from the standalone function
export const dataRefetch = (tags: string[]) => {
  if (tags && tags.length > 0) {
    emitter.emit('refetch', tags)
  }
}
