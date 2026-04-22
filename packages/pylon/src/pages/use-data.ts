import type {UseQueryOptions} from '@gqty/react'
import {useEffect, useRef} from 'react'
import type {Data} from './index'
import {registerRefetch, unregisterRefetch, useDataQuery} from './internals'

interface UseDataOptions extends Omit<
  UseQueryOptions<any>,
  'prepare' | 'suspense'
> {}

export const useData = (options?: UseDataOptions) => {
  const useQuery = useDataQuery()

  const data = useQuery({
    ...options,
    suspense: true
  }) as Data

  const operationName = options?.operationName

  const refetchFn: () => Promise<any> = (data as any).$refetch

  const refetchFnRef = useRef(refetchFn)
  refetchFnRef.current = refetchFn

  useEffect(() => {
    if (operationName) {
      registerRefetch(operationName, refetchFnRef.current)

      return () => {
        unregisterRefetch(operationName, refetchFnRef.current)
      }
    }
  }, [operationName])

  return data
}
