import {
  useMutationDoc,
  stableStringify,
  type MutationState,
  type TypedDoc
} from '@getcronit/pylon/query'
import type {OperationContext} from '@getcronit/pylon'
import {useCallback} from 'react'
import type {Mutations} from './index'
import {dataRefetch} from './use-data'

export interface UseMutationOptions {
  /** After a successful mutation, refetch queries carrying these tags. */
  refetch?: string[]
  /**
   * Per-operation context for this mutation — the app-typed `OperationContext` bag (e.g.
   * `{ context: { actingTenant } }` so a `SUPER_ADMIN` writes into the acted org). Carried as
   * the `$__context` variable and gated server-side by `useDatabase({operationContext})`; a
   * bare value grants nothing. See rfcs/ACTING_TENANT.md.
   */
  context?: OperationContext
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
  // Carry the per-call OperationContext as the `$__context` variable — guarded by
  // `doc.opContext` so it's never sent to a doc that doesn't declare it. Canonical JSON so
  // the value is stable. See `withOperationContext` in use-data.ts for the query twin.
  const context = options?.context
  const contextJson =
    context && doc?.opContext && Object.keys(context).length > 0
      ? stableStringify(context)
      : undefined
  const wrapped = useCallback(
    async (variables?: Record<string, unknown>) => {
      const vars =
        contextJson !== undefined
          ? {...(variables ?? {}), __context: contextJson}
          : variables
      const result = await trigger(vars as any)
      if (options?.refetch && options.refetch.length > 0) {
        dataRefetch(options.refetch)
      }
      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trigger, refetchKey, contextJson]
  )

  return [wrapped, state]
}
