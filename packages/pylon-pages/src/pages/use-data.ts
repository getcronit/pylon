import {
  useQueryDoc,
  usePaginatedDoc,
  type PaginatedResult,
  type TypedDoc,
  type UsePaginatedDocOptions
} from '@getcronit/pylon-query'
import mitt from 'mitt'
import {useEffect} from 'react'
import type {Data} from './index'

// Cross-component refetch bus (unchanged behavior from the gqty version).
type Events = {refetch: string[]}
const emitter = mitt<Events>()

export interface UseDataOptions {
  /** Refetch this query when `dataRefetch(tags)` is called with a matching tag. */
  tags?: string[]
  /**
   * Disable the build-time analyzer document for this call. Escape hatch /
   * debugging only — with no document, `useData()` returns the root `Data` type
   * but won't fetch.
   */
  disableBuildTimeGeneration?: boolean
}

/**
 * Page data hook. The build-time analyzer rewrites `useData()` into
 * `useData(doc, variablesThunk, options)`:
 *
 *  - `doc` is the compiled GraphQL operation (module scope — never a TDZ risk).
 *  - `variablesThunk` is evaluated lazily at first field access, in JSX, below
 *    the component's `const`s — so field-argument variables are never read in
 *    their temporal dead zone.
 *
 * Pre-analysis (hand-written `useData()`), it returns the root `Data` type for
 * authoring autocomplete.
 */
export function useData(): Data
export function useData<TResult>(
  doc: TypedDoc<TResult, any>,
  variables?: () => Record<string, unknown>,
  options?: UseDataOptions
): TResult & {$refetch: () => void}
export function useData(
  doc?: TypedDoc<any, any>,
  variables?: () => Record<string, unknown>,
  options?: UseDataOptions
): any {
  const data = useQueryDoc(doc, variables, options)
  useTagRefetch(options?.tags, () => (data as any)?.$refetch?.())
  return data
}

export interface UsePaginatedDataOptions
  extends UsePaginatedDocOptions {
  tags?: string[]
}

/**
 * Relay-connection pagination hook. The analyzer rewrites
 * `usePaginatedData()` into `usePaginatedData(doc, variablesThunk, options)`
 * where `doc` carries connection metadata. The result is keyed by the
 * connection field so component code reads it the same way it selected it:
 *
 *   const data = usePaginatedData()
 *   data.posts.edges.map(e => e.node.title)
 *   data.posts.loadNext()
 */
export function usePaginatedData(): Data
export function usePaginatedData<TResult>(
  doc: TypedDoc<TResult, any>,
  variables?: () => Record<string, unknown>,
  options?: UsePaginatedDataOptions
): Record<string, PaginatedResult>
export function usePaginatedData(
  doc?: TypedDoc<any, any>,
  variables?: () => Record<string, unknown>,
  options?: UsePaginatedDataOptions
): any {
  if (!doc || !doc.connection) {
    throw new Error(
      'usePaginatedData(): no connection document was injected. The build-time ' +
        'analyzer must see a Relay connection selection (edges/node/pageInfo).'
    )
  }
  const result = usePaginatedDoc(doc, variables, options)
  const field = doc.connection.path[0]
  return {[field]: result}
}

function useTagRefetch(tags: string[] | undefined, refetch: () => void): void {
  // Stringify so an inline `tags={['user']}` array doesn't re-run the effect.
  const key = tags?.join(',')
  useEffect(() => {
    if (!tags || tags.length === 0) return
    const handle = (refetchTags: string[]) => {
      if (tags.some(t => refetchTags.includes(t))) refetch()
    }
    emitter.on('refetch', handle)
    return () => emitter.off('refetch', handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** Trigger a refetch of every mounted query carrying one of these tags. */
export const dataRefetch = (tags: string[]) => {
  if (tags && tags.length > 0) emitter.emit('refetch', tags)
}
