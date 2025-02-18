import React, {useMemo} from 'react'
import {PageProps} from '..'

export const AppLoader = (props: {
  client: any
  pylonData: {
    pageProps: Omit<PageProps, 'data'>
    cacheSnapshot?: any
  }
  App: React.FC<{
    pageProps: PageProps
  }>
  Router: React.FC<any>
  routerProps: any
}) => {
  props.client.useHydrateCache({cacheSnapshot: props.pylonData.cacheSnapshot})

  const data = props.client.useQuery()
  const page = useMemo(() => {
    const page = (
      <props.App
        pageProps={{
          ...props.pylonData.pageProps,
          data
        }}
      />
    )

    return page
  }, [props])

  return <props.Router {...props.routerProps}>{page}</props.Router>
}
