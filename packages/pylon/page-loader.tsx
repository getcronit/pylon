import React, { cloneElement, createElement, JSX, Suspense, useMemo } from "react"
import { PageProps } from "./src"

export const Document: React.FC<{
  clientBundlePaths: {
    js: string
    css: string
  }
  pageProps: Omit<PageProps, 'data'>
  cacheSnapshot?: any
  children: React.ReactNode
}> = props => {
  return (
    <html lang='de'>
      <head>
        <meta charSet='utf-8' />
        <script id="__PYLON_DATA__" type="application/json">
          {JSON.stringify({
            pageProps: props.pageProps,
            cacheSnapshot: props.cacheSnapshot
          })}
        </script>
        <script type="module" defer src={props.clientBundlePaths.js}></script>
        <link rel="stylesheet" href={props.clientBundlePaths.css} />
        <link rel="stylesheet" href="/public/output.css" />
      </head>
      <body>
        <div id="root">{props.children}</div>
      </body>
    </html>
  )
}


// export const PylonPageLoader: React.FC<{
//   client: any
//   pagePath: string
//   Element: React.FC<any>
//   cacheSnapshot?: any
// }> = props => {
//   const Document: React.FC<typeof props> = () => {
//     props.client.useHydrateCache({ cacheSnapshot: props.cacheSnapshot })

//     const data = props.client.useQuery()

//     return (
//       <html>
//         <head>
//           <script>
//             {'window.__pylon_cache_snapshot = ' + JSON.stringify(props.cacheSnapshot)}
//           </script>
//           <script type="module" defer src={`/static/${props.pagePath}`}></script>
//         </head>
//         <body>
//           <div id="root">
//             <props.Element data={data} />
//           </div>
//         </body>
//       </html>
//     )
//   }


//   return <Suspense fallback='Pylon Loading...'>
//     <Document {...props} />
//   </Suspense>
// }

const injectHead = (page: JSX.Element, head: JSX.Element) => {
  return Object.assign({}, page, {
    type: (props) => {
      const pageElement = page.type(props);

      console.log('pageElement', pageElement)
      
      return Object.assign({}, pageElement, {
        type: (props) => {
          const pageElement2 = pageElement.type(props);

          return cloneElement(pageElement2, {
            children: [head, pageElement2.props.children]
          });
        }
      });
    }
  });
}

export const PylonPageLoader = (props: {
  client: any,
  clientBundlePaths: {
    js: string
    css: string
  },
  cacheSnapshot?: any,
  Page: React.FC<PageProps>
  pageProps: Omit<PageProps, 'data'>
}) => {
  props.client.useHydrateCache({ cacheSnapshot: props.cacheSnapshot })

  const data = props.client.useQuery()

  

  const page = useMemo(() => {
  

  const Head: React.FC = () => <head>
    <meta charSet='utf-8' />
    <script id="__PYLON_DATA__" type="application/json">
      {JSON.stringify({
        pageProps: props.pageProps,
        cacheSnapshot: props.cacheSnapshot,
      })}
    </script>
    <script type="module" defer src={props.clientBundlePaths.js}></script>
    <link rel="stylesheet" href={props.clientBundlePaths.css} />
    <link rel="stylesheet" href="/public/output.css" />
  </head>

  const pageWithHead = injectHead(<props.Page data={data} {...props.pageProps}  />, <Head key="head" />)

  return pageWithHead


  }, [props])

  
  return page
}



export async function pageLoader (props: {
  client: any,
  clientBundlePaths: {
    js: string
    css: string
  },
  cacheSnapshot?: any,
  Page: React.FC<PageProps>
  pageProps: Omit<PageProps, 'data'>,
}){


  let page = <PylonPageLoader
    client={props.client}
    clientBundlePaths={props.clientBundlePaths}
    Page={props.Page}
    cacheSnapshot={props.cacheSnapshot}
    pageProps={props.pageProps}
  />

  // Wrap the page in the layouts (from outermost to innermost)

  // for(const [layoutName, layout] of props.layouts.reverse()){
  //   if(layoutName === "pages/layout.tsx" || layoutName === "pages/layout.js"){
      
  //     const head = createElement('head', null, [
  //       <meta charSet='utf-8' />,
  //       <script id="__PYLON_DATA__" type="application/json">
  //         {JSON.stringify({
  //           pageProps: props.pageProps,
  //           cacheSnapshot: props.cacheSnapshot,
  //           layouts: props.layouts.map(([name, _]) => {
  //             // Replace the /pages/ with /public/ and replace the .tsx with .js
  //             return name.replace('pages', '/public').replace('.tsx', '.js')
  //           })
  //         })}
  //       </script>,
  //       <script type="module" defer src={props.clientBundlePaths.js}></script>,
  //       <link rel="stylesheet" href={props.clientBundlePaths.css} />,
  //       <link rel="stylesheet" href="/public/output.css" />
  //     ])

  //     const layoutElement = createElement(layout, { children: page })


  //     const layoutWithHead = cloneElement(layoutElement, {}, [head, layoutElement.props.children])

  //     page = layoutWithHead

  //   }

  //   else {
  //     page = createElement(layout, { children: page })
  //   }
  // }

  console.log("page", page)

  return page

  
}



export const AppLoader = (props: {
  client: any,
  pylonData: {
    pageProps: Omit<PageProps, 'data'>,
    cacheSnapshot?: any,
  }
  App: React.FC<{
    pageProps: PageProps
  }>,
  Router: React.FC<any>,
  routerProps: any
}) => {
  console.log('props', props)
  props.client.useHydrateCache({ cacheSnapshot: props.pylonData.cacheSnapshot })

  const data = props.client.useQuery()

  console.log('data', data.$state)

  const page = useMemo(() => {
    const page = <props.App pageProps={{
      ...props.pylonData.pageProps,
      data,
    }} />

    return page
  }, [props])

  return <props.Router {...props.routerProps}>
    {page}
  </props.Router>
}