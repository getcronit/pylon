import fs from 'fs'
import path from 'path'

const PAGES_DIR = './pages'

/**
 * Interface representing a route configuration.
 */
export interface Route {
  path?: string
  Component?: string
  element?: string
  errorElement?: string
  lazy?: string
  loader?: string
  shouldRevalidate?: string
  index?: boolean
  children?: Route[]
  HydrateFallback?: string
}

/**
 * Context for the scan operation to collect imports and slugs.
 */
interface ScanContext {
  imports: string[]
  routeSlugs: string[]
}

/**
 * Formats a route segment into a component-friendly string.
 * @param segment - The raw route segment.
 * @returns The formatted segment string.
 */
function formatSegment(segment: string): string {
  let sanitized = segment
  if (sanitized.startsWith('[...') && sanitized.endsWith(']')) {
    const param = sanitized.slice(4, -1)
    sanitized = 'CatchAll' + param.charAt(0).toUpperCase() + param.slice(1)
  } else if (sanitized.startsWith('[') && sanitized.endsWith(']')) {
    sanitized = sanitized.slice(1, -1)
  }
  return sanitized.charAt(0).toUpperCase() + sanitized.slice(1)
}

/**
 * Converts a file path to a corresponding layout component name.
 * @param filePath - The file path to convert.
 * @returns The generated layout component name.
 */
export function getLayoutComponentName(filePath: string): string {
  const segments = filePath
    .replace(PAGES_DIR, '')
    .replace(/\\/g, '/')
    .replace(/layout\.tsx$/, '')
    .split('/')
    .filter(Boolean)

  return segments.map(formatSegment).join('') + 'Layout'
}

/**
 * Converts a file path to a corresponding page component name.
 * @param filePath - The file path to convert.
 * @returns The generated page component name.
 */
export function getPageComponentName(filePath: string): string {
  const segments = filePath
    .replace(PAGES_DIR, '')
    .replace(/\\/g, '/')
    .replace(/page\.tsx$/, '')
    .split('/')
    .filter(Boolean)

  return segments.map(formatSegment).join('') + 'Page'
}

/**
 * Converts dynamic route segments from [param] format to :param format.
 * @param segment - A segment of the route.
 * @returns The converted route segment.
 */
export function convertToDynamicRoute(segment: string): string {
  if (segment.startsWith('[...') && segment.endsWith(']')) return '*'
  if (segment.startsWith('[') && segment.endsWith(']'))
    return `:${segment.slice(1, -1)}`
  return segment
}

/**
 * Processes a layout file and updates the route configuration.
 */
function processLayoutItem(
  relativePath: string,
  importPath: string,
  route: Route,
  context: ScanContext
): void {
  const layoutComponentName = getLayoutComponentName(relativePath)
  context.imports.push(`import ${layoutComponentName} from ${importPath};`)

  const componentName =
    layoutComponentName === 'Layout' ? `RootLayout` : `${layoutComponentName}`

  const catchAllParam = relativePath.match(/\[\.\.\.(.+)\]/)?.[1]
  const paramMatches = [...relativePath.matchAll(/\[(.+?)\]/g)].map(m =>
    m[1].replace('...', '')
  )

  route.Component = `withLoaderData((props) => <${componentName} children={<Outlet />} {...props} />, "${componentName}", ${catchAllParam ? `"${catchAllParam}"` : 'undefined'})`
  route.loader = `loader("${componentName}")`
  route.shouldRevalidate = `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = ${JSON.stringify(paramMatches)};
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`

  if (route.path === '/') {
    route.errorElement = '<ErrorElement standalone={true} />'
  }

  route.HydrateFallback = 'HydrateFallback'
}

/**
 * Processes a page file and adds it to the route children.
 */
function processPageItem(
  relativePath: string,
  importPath: string,
  route: Route
): void {
  const catchAllParam = relativePath.match(/\[\.\.\.(.+)\]/)?.[1]
  const pageComponentName = getPageComponentName(relativePath)

  route.children!.push({
    path: undefined,
    index: true,
    errorElement: '<ErrorElement standalone={false} />',
    lazy: `async () => {const i = await import(${importPath}).catch(() => {window.location.reload()}); return {Component: withLoaderData(i.default, "${pageComponentName}", ${catchAllParam ? `"${catchAllParam}"` : 'undefined'})}}`,
    HydrateFallback: 'HydrateFallback',
    loader: `loader("${pageComponentName}")`
  })
}

/**
 * Optimizes the route structure by merging or cleaning up children.
 */
function optimizeRouteStructure(route: Route, hasLayout: boolean): void {
  // If the route has a single child that is a catch-all route, and the current route
  // has no layout, we can merge the match logic.
  if (
    !hasLayout &&
    route.children?.length === 1 &&
    route.children[0].path === '*'
  ) {
    const child = route.children[0]
    const currentPath = route.path === '/' ? '' : route.path
    Object.assign(route, child)
    route.path = currentPath ? `${currentPath}/*` : '*'
    delete route.children
  }

  // If the route IS a catch-all route and there is no layout, we effectively "become"
  // the child page to avoid an empty middle route.
  if (route.path === '*' && !hasLayout && route.children?.length === 1) {
    const child = route.children[0]
    const currentPath = route.path
    Object.assign(route, child)
    route.path = currentPath
    delete route.index
    delete route.children
  }

  // If the route IS a catch-all route AND has a layout, the child page cannot be an index route.
  if (route.path === '*' && hasLayout && route.children) {
    const pageChild = route.children.find(child => child.index)
    if (pageChild) {
      delete pageChild.index
      pageChild.path = '*'
    }
  }
}

/**
 * Recursively scans a directory to build route objects.
 * @param directory - The directory to scan.
 * @param context - The scan context.
 * @param basePath - The base route path accumulated so far.
 * @returns A Route object or null if the directory does not define a route.
 */
export function scanDirectory(
  directory: string,
  context: ScanContext,
  basePath: string = ''
): Route | null {
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
      const childRoute = scanDirectory(itemPath, context, relativePath)
      if (childRoute) {
        route.children!.push(childRoute)
      }
    } else if (item.name === 'layout.tsx') {
      processLayoutItem(relativePath, importPath, route, context)
      hasLayout = true
    } else if (item.name === 'page.tsx') {
      processPageItem(relativePath, importPath, route)
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
      context.routeSlugs.push(fullPath)
    }
  }

  if (hasLayout) {
    const childNotFoundRoute: Route = {
      path: '*',
      element: '<NotFoundPage standalone={false} />'
    }
    if (!route.children) {
      route.children = []
    }
    route.children.push(childNotFoundRoute)
  }

  optimizeRouteStructure(route, hasLayout)

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
      parentKey === 'shouldRevalidate' ||
      parentKey === 'Component' ||
      parentKey === 'element' ||
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
 * Generates the content of the route file.
 */
function generateRouteFileContent(
  context: ScanContext,
  rootRoute: Route | null,
  notFoundRoute: Route
): string {
  return `${context.imports.join('\n')}

import {useMemo, Suspense} from 'react'
import {__PYLON_ROUTER_INTERNALS_DO_NOT_USE, __PYLON_INTERNALS_DO_NOT_USE, GlobalErrorPage, StatusPage} from '@getcronit/pylon/pages'
const {DataClientProvider, InitialDataProvider, useInitialData} = __PYLON_INTERNALS_DO_NOT_USE
const Outlet = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.Outlet

const ErrorElement: React.FC<{standalone: boolean}> = ({standalone}) => {
  const error = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useRouteError()
  console.log("ERROR", error)



  let message = 'An unexpected error occurred.'

  const isResponse = error instanceof Response || (error && typeof error === 'object' && 'status' in error);
  if(isResponse) {
    // Check if the error is a redirect response
    if(error instanceof Response && error.status > 300 && error.status < 400 && error.headers.get('Location')) {
    return <__PYLON_ROUTER_INTERNALS_DO_NOT_USE.Navigate to={error.headers.get('Location')!} replace />
    }

    try {
      const errorData = (error as any).data;
      const rawMessage = typeof errorData === 'string' ? errorData : errorData?.message;
      
      if (rawMessage) {
        try {
          const parsed = JSON.parse(rawMessage);
          message = parsed.message || rawMessage;
        } catch (e) {
          message = rawMessage;
        }
      }
    } catch (e) {}

    if ((error as any).status !== 500) {
      return (
        <StatusPage
          code={(error as any).status}
          title={(error as any).statusText}
          message={message}
          standalone={standalone}
        />
      )
    }
  }

  const displayError = error instanceof Error ? error : new Error(message || (error && typeof error === 'object' && ((error as any).message || (error as any).statusText)) || 'A critical error occurred');
  return <GlobalErrorPage error={displayError as any} standalone={standalone} />
}

const HydrateFallback = () => {
  return <div>Loading...</div>
}

function withLoaderData(Component: React.ComponentType<any>, name?: string, catchAllParam?: string) {
  return function WithLoaderDataWrapper(props: any) {
    const dataClient = __PYLON_INTERNALS_DO_NOT_USE.useDataClient()
    const pruningTarget = __PYLON_INTERNALS_DO_NOT_USE.useSSRPruning()

    const location = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useLocation()
    const [searchParams] = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useSearchParams()
    const searchParamsObject = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])

    const reactRouterParams = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useParams()

    const params = useMemo(() => {
      const params: Record<string, string | string[] | undefined> = reactRouterParams

      if (catchAllParam && reactRouterParams['*']) {
        params[catchAllParam] = reactRouterParams['*']?.split('/')
      }

      return params
    }, [reactRouterParams, catchAllParam])

    const initialData = useInitialData() || (typeof window !== 'undefined' ? (window as any).__PYLON_INITIAL_DATA__ : null)

    const loaderData = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useLoaderData()
    
    // Priority: loaderData (from navigation) > initialData (from script tag)
    const activeData = (loaderData && loaderData.cacheSnapshot) ? loaderData : (initialData || loaderData || {})
    const {cacheSnapshot, context} = activeData

    const isServer = typeof window === 'undefined'

    const pageClient = useMemo(() => {
       if(isServer) return dataClient
       return dataClient.pageClient()
    }, [])

    if(cacheSnapshot && !isServer) {
      pageClient.useHydrateCache({cacheSnapshot})
    }

    const useQuery = pageClient.useQuery

    const pageProps = useMemo(() => {
      return {
        path: location.pathname,
        params,
        searchParams: searchParamsObject,
        context,
      }
    }, [location.pathname, params, searchParamsObject, context])

    // 1. Handle Transparent Ancestors
    // If we're optimized-rendering a specific layout, and THIS is not it,
    // we just act as a passthrough to skip THIS layout's logic/queries.
    // Exception: RootLayout is never skipped to preserve global providers.
    if (pruningTarget && name !== pruningTarget && name !== 'RootLayout') {
      return <Outlet />
    }

    // 2. Handle Pruning Target
    // If THIS is the target, we render it but clear its children (the Outlet).
    const children = pruningTarget && name === pruningTarget ? null : <Outlet />

    return <InitialDataProvider value={initialData}>
      <DataClientProvider client={pageClient}>
        <__PYLON_INTERNALS_DO_NOT_USE.DataQueryProvider useQuery={useQuery}>
          <__PYLON_INTERNALS_DO_NOT_USE.RouteDataProvider props={pageProps} name={name}>
              <Component {...(props as any)} {...pageProps} children={children} />
          </__PYLON_INTERNALS_DO_NOT_USE.RouteDataProvider>
        </__PYLON_INTERNALS_DO_NOT_USE.DataQueryProvider>
      </DataClientProvider>
    </InitialDataProvider>
  };
}

/**
 * Creates an isomorphic data loader for a specific route.
 * On the server: uses requestContext (passed from setup/index.tsx via handler.query())
 *   to access pagesContext directly, avoiding dynamic imports.
 * On the client: fetches JSON from the server with the cache snapshot.
 */
export const loader: (ref?: string) => __PYLON_ROUTER_INTERNALS_DO_NOT_USE.LoaderFunction = (ref) => async ({ request, context }) => {
  const isServer = typeof window === 'undefined';
  
  if (isServer) {
    // The requestContext is passed from setup/index.tsx via handler.query().
    // It contains { pagesContext } — the Hono context data for this request.
    const { pagesContext } = (context as any) || {};
    return { context: pagesContext || {} };
  }

  const url = new URL(request.url);
  const headers = new Headers();
  headers.set('Accept', 'application/json');
  headers.set('X-Pylon-Internal', 'true');
  if (ref) {
    headers.set('X-Pylon-Route-Ref', ref);
  }

  const response = await fetch(url.pathname + url.search, {
    method: 'GET',
    headers,
    signal: request.signal
  });

  // Check for server-side redirect signaled via header.
  // The server returns a 204 with X-Pylon-Redirect instead of a real 302
  // to prevent fetch() from auto-following it (which wastes a round-trip).
  const redirectLocation = response.headers.get('X-Pylon-Redirect');
  if (redirectLocation) {
    throw __PYLON_ROUTER_INTERNALS_DO_NOT_USE.redirect(redirectLocation);
  }

  // Fallback: handle actual HTTP redirects (e.g. from middleware)
  if([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if(location) {
      throw __PYLON_ROUTER_INTERNALS_DO_NOT_USE.redirect(location, response.status);
    }
  }

  if(!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = data.message || response.statusText || 'An unexpected error occurred.';
    throw {
      status: response.status,
      statusText: response.statusText,
      data: data,
      message: message
    };
  }

  try {
    const data = await response.json<any>();

    // Client-Side Version Sync Check:
    if (typeof window !== 'undefined' && data?.version) {
      const clientVersion = (window as any).__PYLON_VERSION__;
      if (clientVersion && data.version !== clientVersion) {
        window.location.reload();
      }
    }

    return data;
    
  } catch (error) {
    throw error;
  }
};




const RootLayout = (props: { children: React.ReactNode; [key: string]: any }) => {
  const manifest = (globalThis as any).__PYLON_MANIFEST__;

  return (
    <Layout {...props}>
      <meta charSet="utf-8" />
      {manifest?.['index.css'] && <link rel="stylesheet" href={manifest['index.css']} precedence="high" />}
      {manifest?.['app.css'] && <link rel="stylesheet" href={manifest['app.css']} precedence="high" />}
      {props.children}
    </Layout>
  )
}

const NotFoundPage: React.FC<{standalone: boolean}> = ({standalone = false}) => {
  return <StatusPage code={404} title="Page Not Found" message="The page you are looking for does not exist." standalone={standalone} />
}

const routes = ${serialize([rootRoute, notFoundRoute].filter(Boolean))}

export default routes

`
}

/**
 * Builds the route configuration and outputs the generated code.
 * @returns The complete file content as a string.
 */
export function makeAppFiles() {
  const context: ScanContext = {imports: [], routeSlugs: []}

  const rootRoute = scanDirectory(PAGES_DIR, context)
  const notFoundRoute: Route = {
    path: '*',
    element: '<NotFoundPage standalone={true} />',
    loader: '() => { return new Response("Not Found", { status: 404 }) }'
  }

  const routes = generateRouteFileContent(context, rootRoute, notFoundRoute)
  const slugs = `export default ${JSON.stringify(context.routeSlugs, null, 2)}`

  return {
    routes,
    slugs
  }
}
