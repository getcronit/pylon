import {useCallback} from 'react'
import {refetchRegistry} from './internals'

/**
 * Hook to trigger data refetching for one or more `useData` hooks by their `operationName`.
 *
 * @param operationNames - An array of operation names that were registered using the `operationName` option in `useData`.
 * @returns A stable refetch function that triggers all matching hooks and returns a Promise that resolves when all are complete.
 *
 * @example
 * ```tsx
 * const refetch = useDataRefetch(['layout', 'sidebar'])
 *
 * const handleRefresh = async () => {
 *   await refetch()
 * }
 * ```
 */
export const useDataRefetch = (operationNames: string[]) => {
  const refetch = useCallback(
    (ignoreCache?: boolean) => {
      const promises: Promise<any>[] = []

      for (const name of operationNames) {
        const fns = refetchRegistry.get(name)
        if (fns) {
          for (const fn of fns) {
            promises.push(fn(ignoreCache))
          }
        }
      }

      return Promise.all(promises)
    },
    [operationNames]
  )

  return refetch
}
