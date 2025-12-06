import {createContext, useContext} from 'react'
import {PageProps} from '.'

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

const RouteDataContext = createContext<PageProps | null>(null)

const RouteDataProvider: React.FC<{
  children: React.ReactNode
  props: PageProps
}> = ({children, props}) => {
  return (
    <RouteDataContext.Provider value={props}>
      {children}
    </RouteDataContext.Provider>
  )
}

const useRouteData = () => {
  const context = useContext(RouteDataContext)

  if (!context) {
    throw new Error('useRouteData must be used within a RouteDataProvider')
  }

  return context
}

export {RouteDataProvider, useRouteData}
