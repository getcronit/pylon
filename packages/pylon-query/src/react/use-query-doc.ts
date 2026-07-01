import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react'
import {opKey, type TypedDoc} from '../runtime/doc'
import {usePylonQueryClient} from './context'

export interface UseQueryDocOptions {
  /**
   * Disable the build-time analyzer's document for this call. The hook then has
   * no document and returns `undefined` — escape hatch / debugging only.
   */
  disableBuildTimeGeneration?: boolean
}

export type WithRefetch<T> = T & {$refetch: () => void}

/**
 * Core single-operation hook. The analyzer injects `(doc, variablesThunk)`.
 *
 * `variablesThunk` is a THUNK on purpose: it is evaluated lazily, at first
 * field access (inside the wrapper), which happens in JSX — below the
 * component's `const` declarations — so reading later-declared locals as field
 * arguments never hits a temporal dead zone.
 */
export function useQueryDoc<TResult, TVars extends Record<string, unknown>>(
  doc: TypedDoc<TResult, TVars> | undefined,
  variablesThunk?: () => TVars,
  _options?: UseQueryDocOptions
): WithRefetch<TResult> {
  const client = usePylonQueryClient()

  // Re-render on any store change (SWR revalidation, refetch, mutation
  // invalidation). Coarse but correct; per-key subscription is a later
  // optimization (it would require the opKey, which needs variables — and those
  // can't be evaluated at the top of render without risking a TDZ).
  useSyncExternalStore(
    client.store.subscribe,
    client.store.getVersion,
    client.store.getVersion
  )

  // SWR revalidation on mount / variables change ONLY — never on every render.
  // The subscription above re-renders this hook on ANY mutation, and `ensure`
  // is render-pure, so revalidation must be driven from an effect. No dep array:
  // the body runs after every commit but self-guards on the operation key, so it
  // refetches just once per mount and again only when the variables change.
  // (The thunk is evaluated here, post-commit, where component locals are
  // initialized — so reading later-declared locals never hits a TDZ.)
  const lastKeyRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!doc) return
    const vars = variablesThunk ? variablesThunk() : undefined
    const key = opKey(doc, vars)
    if (key === lastKeyRef.current) return
    lastKeyRef.current = key
    client.revalidate(doc, vars as TVars)
  })

  // Keep the LATEST variables thunk in a ref. `refetch`'s deps are [client, doc]
  // (stable across a soft-nav that only changes variables — same component, same
  // document), so closing over `variablesThunk` directly would refetch the
  // PREVIOUS route's variables: e.g. navigate ticket A → B, add a note on B, and
  // the tag-refetch would re-fetch A (the page you navigated away from), so B
  // never refreshes. The ref makes refetch always read the current variables.
  const varsThunkRef = useRef(variablesThunk)
  varsThunkRef.current = variablesThunk

  const refetch = useCallback(() => {
    if (!doc) return
    const vars = varsThunkRef.current ? varsThunkRef.current() : undefined
    void client.refetch(doc, vars as TVars).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, doc])

  if (!doc) {
    return {$refetch: refetch} as WithRefetch<TResult>
  }

  // Memoized-per-render root getter. The first field access calls it; on a
  // cache miss it throws the in-flight promise → Suspense.
  let resolved = false
  let rootData: unknown
  const getRoot = (): unknown => {
    if (resolved) return rootData
    const vars = variablesThunk ? variablesThunk() : undefined
    const read = client.ensure(doc, vars as TVars)
    if (read.error !== undefined) throw read.error
    if (read.promise) throw read.promise
    rootData = read.data
    resolved = true
    return rootData
  }

  return client.wrapData<WithRefetch<TResult>>(getRoot, {$refetch: refetch}, undefined, doc.name)
}
