import {
  useQueryDoc,
  usePaginatedDoc,
  stableStringify,
  type PaginatedResult,
  type TypedDoc
} from '@getcronit/pylon/query'
import type {OperationContext} from '@getcronit/pylon'
import mitt from 'mitt'
import {useEffect, useRef} from 'react'
import type {Data} from './index'
import {useRouteId} from './internals'

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
  /**
   * Per-operation context for THIS call — the app-typed `OperationContext` bag. The flagship
   * use is acting-as-tenant (`{ context: { actingTenant } }`), gated server-side by
   * `useDatabase({operationContext})`; a bare value grants nothing. Carried as the
   * `$__context` variable, so it folds into the cache key (two contexts never share an entry)
   * and threads through SSR unchanged. Omit it and the call runs with no context. See
   * rfcs/ACTING_TENANT.md.
   */
  context?: OperationContext
}

/**
 * Merge the per-call `OperationContext` into an operation's variables, as a canonical JSON
 * string (`stableStringify` → key order can't split the cache). Guarded by `doc.opContext`
 * so `$__context` is never sent to a document that doesn't declare it (GraphQL would reject
 * the unknown variable) — a stray `{context}` on a hand-written doc is ignored. An empty bag
 * is dropped so it keys identically to no context.
 */
function withOperationContext(
  doc: TypedDoc<any, any> | undefined,
  variables: (() => Record<string, unknown>) | undefined,
  context: OperationContext | undefined
): (() => Record<string, unknown>) | undefined {
  if (context == null || !doc?.opContext || Object.keys(context).length === 0) {
    return variables
  }
  return () => ({
    ...(variables ? variables() : {}),
    __context: stableStringify(context)
  })
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
// Authoring form with options (e.g. `useData({ tags: ['post'] })`): the analyzer
// rewrites it to `useData(doc, thunk, options)`, preserving this object as the 3rd
// (options) arg. Placed AFTER the `doc` overload: an options LITERAL isn't assignable
// to TypedDoc (which requires id/body/name), so it falls through to here, while a
// real doc variable still matches the `doc` overload and keeps its TResult inference.
export function useData(options: UseDataOptions): Data
export function useData(
  doc?: TypedDoc<any, any> | UseDataOptions,
  variables?: () => Record<string, unknown>,
  options?: UseDataOptions
): any {
  // The current route id owns this read: if it fails during SSR, the pages handler
  // renders THIS route's error boundary (not the leaf's). Undefined outside a route
  // provider — the handler then falls back to leaf attribution.
  const owner = useRouteId()
  const typedDoc = doc as TypedDoc<any, any> | undefined
  const variablesWithContext = withOperationContext(
    typedDoc,
    variables,
    options?.context
  )
  const data = useQueryDoc(typedDoc, variablesWithContext, {
    ...options,
    owner
  })
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

  const owner = useRouteId()
  const result = usePaginatedDoc(doc, mergedThunk, {
    first: typeof ua.first === 'number' ? ua.first : undefined,
    owner
  })

  // `dataRefetch(tags)` with a matching tag force-refetches the loaded windows
  // in place — same bus as useData, so mutations/refresh buttons refresh lists.
  useTagRefetch(ua.tags as string[] | undefined, () => void result.refetch())

  return result
}

function useTagRefetch(tags: string[] | undefined, refetch: () => void): void {
  // Keep the LATEST refetch in a ref so the (once-subscribed) handler always
  // calls the current one. Without this it captures the first render's closure —
  // e.g. a paginated list's `refetch` bound to only the initial window, so a
  // tag-refetch would refresh just the first page.
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  // Stringify so an inline `tags={['user']}` array doesn't re-run the effect.
  const key = tags?.join(',')
  useEffect(() => {
    if (!tags || tags.length === 0) return
    const handle = (refetchTags: string[]) => {
      if (tags.some(t => refetchTags.includes(t))) refetchRef.current()
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
