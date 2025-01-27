import { Suspense } from "react"
import { PageProps } from "./src"


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

export const PylonPageLoader = (props: {
  client: any,
  cacheSnapshot?: any,
  Page: React.FC<PageProps>
  pageProps: Omit<PageProps, 'data'>
}) => {
  props.client.useHydrateCache({ cacheSnapshot: props.cacheSnapshot })

  const data = props.client.useQuery()

  return <props.Page data={data} {...props.pageProps}  />
}

