import {
  useMutationDoc,
  type MutationState,
  type TypedDoc
} from '@getcronit/pylon/query'
import {useCallback} from 'react'
import type {Mutations} from './index'
import {dataRefetch} from './use-data'

export interface UseMutationOptions {
  /** After a successful mutation, refetch queries carrying these tags. */
  refetch?: string[]
}

// Mutations[K] is `(args) => Return` (callable-field style); extract both.
type ArgsOf<F> = F extends (args: infer A) => any ? A : Record<string, never>
type ResultOf<F> = F extends (...a: any[]) => infer R ? R : F
type Trigger<F> = (variables?: ArgsOf<F>) => Promise<ResultOf<F>>

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
export function useMutation<K extends keyof Mutations>(
  key: K,
  options?: UseMutationOptions
): [Trigger<Mutations[K]>, MutationState]
export function useMutation<TResult>(
  doc: TypedDoc<TResult, any>,
  options?: UseMutationOptions
): [(variables?: Record<string, unknown>) => Promise<TResult>, MutationState]
export function useMutation(
  docOrKey: TypedDoc<any, any> | keyof Mutations,
  options?: UseMutationOptions
): any {
  // Post-analysis this is always a TypedDoc; the string key only exists in
  // source before the analyzer rewrites it.
  const doc =
    typeof docOrKey === 'object'
      ? (docOrKey as TypedDoc<any, any>)
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
