import React, {useMemo} from 'react'
import {PageProps} from '..'

export const AppLoader = (props: {
  client: any
  pylonData: {
    cacheSnapshot?: any
  }
  App: React.FC<{
    data: PageProps['data']
  }>
  Router: React.FC<any>
  routerProps: any
}) => {
  props.client.useHydrateCache({cacheSnapshot: props.pylonData.cacheSnapshot})

  const data = props.client.useQuery()
  const page = useMemo(() => {
    const page = <props.App data={data} />

    return page
  }, [props])

  return <props.Router {...props.routerProps}>{page}</props.Router>
}
