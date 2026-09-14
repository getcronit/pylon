import {useCallback, useRef, useState} from 'react'
import type {TypedDoc} from '../runtime/doc'
import {usePylonQueryClient} from './context'

export interface MutationState {
  loading: boolean
  /** The last error, or undefined. Also thrown by the trigger for try/catch. */
  error?: unknown
}

export type MutationTrigger<TResult, TVars> = (
  variables?: TVars
) => Promise<TResult>

/**
 * Core mutation hook. The analyzer injects `useMutationDoc(doc)` where `doc` is
 * the compiled mutation (`mutation X($input) { field(...) { allScalars + nested
 * + id + __typename } }`).
 *
 * The trigger RETURNS the result (for the imperative follow-up) and throws on
 * error; `state` carries only transient `{loading, error}`. The rendered view of
 * the mutated entity comes from the normalized cache via `useData`, not here.
 */
export function useMutationDoc<TResult = any, TVars extends Record<string, unknown> = any>(
  doc: TypedDoc<TResult, TVars>
): [MutationTrigger<TResult, TVars>, MutationState] {
  const client = usePylonQueryClient()
  const [state, setState] = useState<MutationState>({loading: false})
  // Guard setState after unmount.
  const mounted = useRef(true)
  mounted.current = true

  const trigger = useCallback<MutationTrigger<TResult, TVars>>(
    async variables => {
      if (!doc) {
        throw new Error(
          'useMutation(): no mutation document was injected by the analyzer.'
        )
      }
      setState({loading: true, error: undefined})
      try {
        const result = await client.runMutation<TResult>(doc, variables)
        if (mounted.current) setState({loading: false, error: undefined})
        return result
      } catch (error) {
        if (mounted.current) setState({loading: false, error})
        throw error
      }
    },
    [client, doc]
  )

  return [trigger, state]
}
