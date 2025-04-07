import {createContext, useContext} from 'react'

const dataClientContext = createContext<{
  client: any
} | null>(null)

const DataClientProvider: React.FC<{
  client: any
  children: React.ReactNode
}> = ({children, client}) => {
  return (
    <dataClientContext.Provider value={{client}}>
      {children}
    </dataClientContext.Provider>
  )
}

const useDataClient = () => {
  const context = useContext(dataClientContext)

  if (!context) {
    throw new Error('useDataClient must be used within a DataClientProvider')
  }

  return context.client
}

export {DataClientProvider, useDataClient}
