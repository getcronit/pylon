import path from 'path'
import glob from 'tiny-glob'

function fnv1aHash(str: string) {
  let hash = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return (hash >>> 0).toString(16)
}

const APP_DIR = path.join(process.cwd(), 'pages')

export type PageRoute = {
  pagePath: string
  slug: string
  layouts: string[]
}

// Helper function to get page routes with layouts
export async function getPageRoutes(dir = APP_DIR) {
  const routes: PageRoute[] = []

  // Glob pattern for `page.tsx` and `page.js` files
  const pagePattern = path.join(dir, '**/page.{ts,tsx,js}') // Matches page.tsx, page.js, page.ts

  // Glob pattern for layout files
  const layoutPattern = path.join(dir, '**/layout.tsx') // Matches layout.tsx files

  // Get all page files
  const pageFiles = await glob(pagePattern)

  // Get all layout files
  const layoutFiles = await glob(layoutPattern)

  for (const pagePath of pageFiles) {
    const relativePagePath = path.relative(APP_DIR, pagePath) // Get the relative path from the app folder
    let slug =
      '/' +
      relativePagePath
        .replace(/page\.(ts|tsx|js)$/, '')
        .replace(/\[([\w-]+)\]/g, ':$1')

    // Make sure there is no trailing slash
    slug = slug.replace(/\/$/, '')

    // Find layouts relevant to this page
    const layouts = layoutFiles.filter(layout => {
      return pagePath.startsWith(layout.replace('layout.tsx', ''))
    })

    const layoutsWithoutRootLayout = layouts.slice(1)

    routes.push({
      pagePath: pagePath,
      slug: slug || '/',
      layouts: layoutsWithoutRootLayout
    })
  }

  return routes
}

export const generateAppFile = (pageRoutes: PageRoute[]): string => {
  const makePageMap = (routes: PageRoute[]) => {
    const pageMap: Record<string, string> = {}
    for (const route of routes) {
      pageMap[route.pagePath] = `Page${fnv1aHash(route.pagePath)}`
    }
    return pageMap
  }

  const makeLayoutMap = (routes: PageRoute[]) => {
    const layoutMap: Record<string, string> = {}
    for (const route of routes) {
      for (const layout of route.layouts) {
        layoutMap[layout] = `Layout${fnv1aHash(layout)}`
      }
    }
    return layoutMap
  }

  const pageMap = makePageMap(pageRoutes)
  const layoutMap = makeLayoutMap(pageRoutes)

  const importPages = Object.keys(pageMap)
    .map((pagePath, index) => {
      const importLocation = `../${pagePath}`.replace('.tsx', '.js')
      const componentName = pageMap[pagePath]

      return `const ${componentName} = lazy(() => import('${importLocation}'))
      `
    })
    .join('\n')

  const importLayouts = Object.keys(layoutMap)
    .map((layoutPath, index) => {
      const importLocation = `../${layoutPath}`.replace('.tsx', '.js')
      const componentName = layoutMap[layoutPath]

      return `const ${componentName} = lazy(() => import('${importLocation}'))
      `
    })
    .join('\n')

  // Dynamically build the App component with React Router Routes
  const appComponent = `"use client";
  import {lazy, Suspense, useMemo} from 'react'
 import { __PYLON_ROUTER_INTERNALS_DO_NOT_USE, DevOverlay, PageProps} from '@getcronit/pylon/pages';
   const {Routes, Route, useParams, useSearchParams, useLocation} = __PYLON_ROUTER_INTERNALS_DO_NOT_USE
  ${importPages}
  const RootLayout = lazy(() => import('../pages/layout.js'))
  ${importLayouts}

  const InjectPageProps: React.FC<{Page: React.FC, data: PageProps["data"]}> = ({Page, data}) => {
    const params = useParams();
    const [searchParams] = useSearchParams();
    const location = useLocation();

    const pageProps = useMemo(() => {
      return {
        data,
        params,
        searchParams: Object.fromEntries(searchParams.entries()),
        location: location.pathname
      }
    }, [data, params, searchParams, location.pathname])

    return <Page {...pageProps} />
  }
  
  const App: React.FC<{data: PageProps["data"]}> = (props) => {
    return (
      <DevOverlay>
        <RootLayout>
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <link rel="stylesheet" href="/__pylon/static/app.css" precedence="high" />
              <Routes>
              ${pageRoutes
                .map((route, index) => {
                  return `<Route key={${index}} index={${
                    index === 0 ? 'true' : 'false'
                  }} path="${route.slug}" element={
                  ${route.layouts.reduceRight(
                    (child, layoutPath, layoutIndex) => {
                      const layoutName = layoutMap[layoutPath]

                      return `<${layoutName}>${child}</${layoutName}>`
                    },
                    `<InjectPageProps Page={${
                      pageMap[route.pagePath]
                    } as React.FC} data={props.data} />`
                  )}
            } />`
                })
                .join('\n')}
          </Routes>
          </RootLayout>
        </DevOverlay>
    )
  }
  
  export default App;
    `

  return appComponent
}
