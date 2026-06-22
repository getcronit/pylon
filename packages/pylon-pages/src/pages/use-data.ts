import {
  useQueryDoc,
  usePaginatedDoc,
  type PaginatedResult,
  type TypedDoc
} from '@getcronit/pylon-query'
import mitt from 'mitt'
import {useEffect} from 'react'
import type {Data} from './index'

// Connection arg → node type inference for the selector form.
type NodeOf<C> = C extends {edges: (infer E)[]}
  ? E extends {node: infer N}
    ? N
    : any
  : C extends {nodes: (infer N)[]}
    ? N
    : any
type ConnArgs<F> = F extends (args: infer A) => any
  ? // NonNullable: the connection field's args param is optional, so `A` includes
    // `undefined` — `Omit<… | undefined>` would drop the base args (e.g. `query`).
    Omit<NonNullable<A>, 'first' | 'after' | 'last' | 'before' | 'skip'> & {
      first?: number
      /** Refetch this list when `dataRefetch(tags)` matches (create/delete). */
      tags?: string[]
    }
  : {first?: number; tags?: string[]}

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

const PAGINATION_KEYS = ['first', 'after', 'last', 'before']

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
// Authoring: `usePaginatedData(q => q.posts, { category })` or nested
// `usePaginatedData(q => q.post({ id }).comments, { role })`.
export function usePaginatedData<F extends (args: any) => any>(
  selector: (q: Data) => F,
  args?: ConnArgs<F>
): PaginatedResult<NodeOf<ReturnType<F>>>
// Injected by the analyzer: (doc, base-vars thunk from the selector, user args).
export function usePaginatedData<TResult>(
  doc: TypedDoc<TResult, any>,
  baseVarsThunk?: () => Record<string, unknown>,
  userArgs?: Record<string, unknown>
): PaginatedResult
export function usePaginatedData(
  docOrSelector: any,
  baseVarsThunk?: any,
  userArgs?: any
): any {
  const doc =
    typeof docOrSelector === 'object'
      ? (docOrSelector as TypedDoc<any, any>)
      : undefined
  if (!doc || !doc.connection) {
    throw new Error(
      'usePaginatedData(): no connection document was injected. Pass a connection ' +
        'selector, e.g. `q => q.posts` or `q => q.post({ id }).comments`.'
    )
  }

  // Split the user args: base GraphQL args (e.g. `role`) join the connection
  // variables; `first` is the page size; pagination keys are hook-managed.
  const ua = userArgs ?? {}
  const baseArgs: Record<string, unknown> = {}
  for (const k of Object.keys(ua)) {
    if (k !== 'first' && k !== 'tags' && !PAGINATION_KEYS.includes(k)) {
      baseArgs[k] = ua[k]
    }
  }
  const mergedThunk = () => ({...(baseVarsThunk ? baseVarsThunk() : {}), ...baseArgs})

  const result = usePaginatedDoc(doc, mergedThunk, {
    first: typeof ua.first === 'number' ? ua.first : undefined
  })

  // `dataRefetch(tags)` with a matching tag force-refetches the loaded windows
  // in place — same bus as useData, so mutations/refresh buttons refresh lists.
  useTagRefetch(ua.tags as string[] | undefined, () => void result.refetch())

  return result
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
