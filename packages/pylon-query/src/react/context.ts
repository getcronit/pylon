import {createContext, useContext} from 'react'
import type {PylonQueryClient} from '../runtime/client'

const PylonQueryContext = createContext<PylonQueryClient | null>(null)

export const PylonQueryProvider = PylonQueryContext.Provider

export function usePylonQueryClient(): PylonQueryClient {
  const client = useContext(PylonQueryContext)
  if (!client) {
    throw new Error(
      'usePylonQueryClient must be used within a <PylonQueryProvider>'
    )
  }
  return client
}
