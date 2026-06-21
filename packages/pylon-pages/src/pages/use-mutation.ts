import {
  useMutationDoc,
  type MutationState,
  type TypedDoc
} from '@getcronit/pylon-query'
import {useCallback} from 'react'
import {dataRefetch} from './use-data'

export interface UseMutationOptions {
  /** After a successful mutation, refetch queries carrying these tags. */
  refetch?: string[]
}

/**
 * Mutation hook. Authored as:
 *
 *   const [createUser, { loading, error }] = useMutation(m => m.createUser)
 *   const user = await createUser({ name })   // result for the imperative follow-up
 *
 * The build-time analyzer rewrites the `m => m.createUser` selector into the
 * compiled mutation document (allScalars + id + __typename, so the result
 * normalizes into the cache and every `useData` reading that entity re-renders).
 * The trigger returns the result and throws on error; `state` is `{loading,
 * error}`. The rendered view of the mutated entity comes from the cache, not here.
 *
 * `refetch` covers list membership (creates/deletes) the entity patch can't:
 *   const [createUser] = useMutation(m => m.createUser, { refetch: ['users'] })
 */
export function useMutation<TField>(
  selector: (m: any) => TField,
  options?: UseMutationOptions
): [(variables?: Record<string, unknown>) => Promise<TField>, MutationState]
export function useMutation<TResult>(
  doc: TypedDoc<TResult, any>,
  options?: UseMutationOptions
): [(variables?: Record<string, unknown>) => Promise<TResult>, MutationState]
export function useMutation(
  docOrSelector: TypedDoc<any, any> | ((m: any) => unknown),
  options?: UseMutationOptions
): any {
  // Post-analysis this is always a TypedDoc; the selector form only exists in
  // source before the analyzer rewrites it.
  const doc =
    typeof docOrSelector === 'object'
      ? (docOrSelector as TypedDoc<any, any>)
      : undefined
  const [trigger, state] = useMutationDoc(doc as TypedDoc<any, any>)

  const refetchKey = options?.refetch?.join(',')
  const wrapped = useCallback(
    async (variables?: Record<string, unknown>) => {
      const result = await trigger(variables as any)
      if (options?.refetch && options.refetch.length > 0) {
        dataRefetch(options.refetch)
      }
      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trigger, refetchKey]
  )

  return [wrapped, state]
}
