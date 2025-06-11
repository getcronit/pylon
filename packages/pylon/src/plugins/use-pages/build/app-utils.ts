import fs from 'fs'
import path from 'path'

const PAGES_DIR = './pages'

/**
 * Interface representing a route configuration.
 */
interface Route {
  path?: string
  Component?: string
  errorElement?: string
  lazy?: string
  loader?: string
  index?: boolean
  children?: Route[]
  HydrateFallback?: string
}

/**
 * Array to collect import statements.
 */
let imports: string[] = []

/**
 * Array to store the route slugs.
 */
let routeSlugs: string[] = []

/**
 * Converts a file path to a corresponding layout component name.
 * @param filePath - The file path to convert.
 * @returns The generated layout component name.
 */
function getLayoutComponentName(filePath: string): string {
  return (
    filePath
      .replace(PAGES_DIR, '')
      .replace(/\\/g, '/')
      .replace(/layout\.tsx$/, '')
      .split('/')
      .filter(Boolean)
      .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('') + 'Layout'
  )
}

/**
 * Converts dynamic route segments from [param] format to :param format.
 * @param segment - A segment of the route.
 * @returns The converted route segment.
 */
function convertToDynamicRoute(segment: string): string {
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return `:${segment.slice(1, -1)}`
  }
  return segment
}

/**
 * Recursively scans a directory to build route objects.
 * @param directory - The directory to scan.
 * @param basePath - The base route path accumulated so far.
 * @returns A Route object or null if the directory does not define a route.
 */
function scanDirectory(directory: string, basePath: string = ''): Route | null {
  const items = fs.readdirSync(directory, {withFileTypes: true})
  const route: Route = {path: basePath || '/', children: []}
  let hasLayout = false
  let pageFound = false

  for (const item of items) {
    const itemPath = path.join(directory, item.name)
    const relativePath = path.join(basePath, item.name).replace(/\\/g, '/')
    const importPath = `"./${path
      .join('..', PAGES_DIR, relativePath)
      .replace(/\.tsx$/, '')}"`

    if (item.isDirectory()) {
      const childRoute = scanDirectory(itemPath, relativePath)
      if (childRoute) {
        route.children!.push(childRoute)
      }
    } else if (item.name === 'layout.tsx') {
      const layoutComponentName = getLayoutComponentName(relativePath)
      imports.push(`import ${layoutComponentName} from ${importPath};`)

      const componentName =
        layoutComponentName === 'Layout'
          ? `RootLayout`
          : `${layoutComponentName}`

      route.Component = `withLoaderData((props) => <${componentName} children={<Outlet />} {...props} />)`
      route.loader = `loader`

      if (route.path === '/') {
        route.errorElement = '<ErrorElement standalone={true} />'
      }

      route.HydrateFallback = 'HydrateFallback'

      hasLayout = true
    } else if (item.name === 'page.tsx') {
      // if (hasLayout) {
      //   route.children!.push({
      //     path: undefined,
      //     index: true,
      //     lazy: `async () => {const i = await import(${importPath}); return {Component: withLoaderData(i.default)}}`,
      //     loader: `loader`
      //   })
      // } else {
      //   route.lazy = `async () => {const i = await import(${importPath}); return {Component: withLoaderData(i.default)}}`
      //   route.loader = `loader`
      //   if (basePath === '') {
      //     route.index = true
      //   }
      // }

      route.children!.push({
        path: undefined,
        index: true,
        errorElement: '<ErrorElement standalone={false} />',
        lazy: `async () => {const i = await import(${importPath}).catch(() => {window.reload()}); return {Component: withLoaderData(i.default)}}`,
        HydrateFallback: 'HydrateFallback'
      })

      pageFound = true
    }
  }

  // Process dynamic segments on the route's own path
  if (route.path) {
    const segments = route.path
      .split('/')
      .map(segment => convertToDynamicRoute(segment))
      .filter(Boolean)
    const fullPath = segments.length > 0 ? `/${segments.join('/')}` : '/'
    route.path = segments[segments.length - 1] || '/'
    if (hasLayout || pageFound) {
      routeSlugs.push(fullPath)
    }
  }

  if (
    hasLayout ||
    route.lazy ||
    (route.children && route.children.length > 0)
  ) {
    return route
  }
  return null
}

/**
 * Serializes an object into a string that represents code.
 * @param obj - The object to serialize.
 * @returns The serialized representation.
 */
function serialize(obj: any, parentKey?: string | number): string {
  if (Array.isArray(obj)) {
    return `[${obj.map(serialize).join(', ')}]`
  } else if (obj && typeof obj === 'object') {
    const entries = Object.entries(obj).map(
      ([key, value]) => `${JSON.stringify(key)}: ${serialize(value, key)}`
    )
    return `{${entries.join(', ')}}`
  } else if (typeof obj === 'string') {
    if (
      parentKey === 'lazy' ||
      parentKey === 'loader' ||
      parentKey === 'Component' ||
      parentKey === 'errorElement' ||
      parentKey === 'HydrateFallback'
    ) {
      return obj
    }

    return JSON.stringify(obj)
  } else {
    return String(obj)
  }
}

/**
 * Builds the route configuration and outputs the generated code.
 * @returns The complete file content as a string.
 */
export function makeAppFiles() {
  imports = []
  routeSlugs = []

  const rootRoute = scanDirectory(PAGES_DIR)
  const notFoundRoute: Route = {
    path: '*',
    Component: 'NotFoundPage'
  }

  const routes = `${imports.join('\n')}

import {__PYLON_ROUTER_INTERNALS_DO_NOT_USE, __PYLON_INTERNALS_DO_NOT_USE, GlobalErrorPage, StatusPage} from '@getcronit/pylon/pages'
const Outlet = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.Outlet

const ErrorElement: React.FC<{standalone: boolean}> = ({standalone}) => {
  const error = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useRouteError()


    if(error instanceof Response) {
      // Check if the error is a redirect response
      if(error.status > 300 && error.status < 400 && error.headers.get('Location')) {
      return <__PYLON_ROUTER_INTERNALS_DO_NOT_USE.Navigate to={error.headers.get('Location')!} replace />
      }

      let message = 'An unexpected error occurred.'

    try {
      const data = JSON.parse(error.data?.message || '{}')
      if (data.message) {
        message = data.message
      }
    } catch (e) {}

    return (
      <StatusPage
        code={error.status}
        title={error.statusText}
        message={message}
        standalone={standalone}
      />
    )
  }

  return <GlobalErrorPage error={error} />
}

const HydrateFallback = () => {
  return <div>Loading...</div>
}

function withLoaderData<T>(Component: React.ComponentType<{ data: T }>) {
  return function WithLoaderDataWrapper(props: T) {
    const client = __PYLON_INTERNALS_DO_NOT_USE.useDataClient()
    const cacheSnapshot = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useLoaderData()


    const location = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useLocation()
    const [searchParams] = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useSearchParams()
    const searchParamsObject = Object.fromEntries(searchParams.entries())
    const params = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useParams()

    client.useHydrateCache({cacheSnapshot})
    const data = client.useQuery()

    return <Component {...(props as any)} path={location.pathname} params={params} searchParams={searchParamsObject} data={data} />;
  };
}

const loader: __PYLON_ROUTER_INTERNALS_DO_NOT_USE.LoaderFunction = async ({ request }) => {
  // 1. Skip if request is a JSON-only fetch (e.g., client-side route preloading)
  const acceptHeader = request.headers.get('accept')
  if (acceptHeader?.includes('application/json')) {
    return null
  }

  const url = new URL(request.url)
  const headers = new Headers()
  let fetchToUse: typeof fetch = fetch

  try {
    // 2. Try importing Pylon — if this works, we're on the server
    const moduleNameToPreventBundling = '@getcronit/pylon'
    const { app, getContext } = await import(moduleNameToPreventBundling)
    fetchToUse = app.request

    // 3. Get headers from the original server request and forward them
    const context = getContext()
    for (const [key, value] of context.req.raw.headers.entries()) {
      headers.append(key, value)
    }
  } catch {
    // 4. Pylon not available — fallback to default fetch (runs in browser)
    // No additional headers are needed; browser sends cookies automatically
  }

  headers.set('Accept', 'application/json') // Ensure the internal request gets JSON

  const response = await fetchToUse(url.pathname + url.search, {
      method: 'GET',
      headers,
  })

  try {
    const data = await response.json<object>()
    return data
  } catch {
    return null
  }
}


const RootLayout = (props: { children: React.ReactNode; [key: string]: any }) => {
  return (
    <Layout {...props}>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="stylesheet" href="/__pylon/static/app.css" precedence="high" />
      {props.children}
    </Layout>
  )
}

const NotFoundPage = () => {
  return <StatusPage code={404} title="Page Not Found" message="The page you are looking for does not exist." standalone />
}

const routes = ${serialize([rootRoute, notFoundRoute].filter(Boolean))}

export default routes

`

  const slugs = `export default ${JSON.stringify(routeSlugs, null, 2)}`

  return {
    routes,
    slugs
  }
}
