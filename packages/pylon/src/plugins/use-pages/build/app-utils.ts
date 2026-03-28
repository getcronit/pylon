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
    if (child.index || child.path === '*') {
      const currentPath = route.path
      Object.assign(route, child)
      route.path = currentPath
      delete route.index
      delete route.children
    }
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
      element: '<NotFoundPage standalone={false} />',
      loader: '() => { return new Response("Not Found", { status: 404 }) }'
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

import {useMemo} from 'react'

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

function withLoaderData<T>(Component: React.ComponentType<{ data: T }>, name?: string, catchAllParam?: string) {
  return function WithLoaderDataWrapper(props: T) {
    const dataClient = __PYLON_INTERNALS_DO_NOT_USE.useDataClient()
    const pruningTarget = __PYLON_INTERNALS_DO_NOT_USE.useSSRPruning()

    const {cacheSnapshot, context} = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.useLoaderData() || {};
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

    // 1. Handle Transparent Ancestors
    // If we're optimized-rendering a specific layout, and THIS is not it,
    // we just act as a passthrough to skip THIS layout's logic/queries.
    // Exception: RootLayout is never skipped to preserve global providers.
    if (pruningTarget && name !== pruningTarget && name !== 'RootLayout') {
      return <Outlet />
    }

    const {useQuery, useHydrateCache} = useMemo(() => dataClient.pageClient(), [])

    if(cacheSnapshot) {
      useHydrateCache({cacheSnapshot})
    }

    const data = typeof window !== "undefined" ? useQuery() : dataClient.useQuery()

    const pageProps = useMemo(() => {
      return {
        path: location.pathname,
        params,
        searchParams: searchParamsObject,
        data,
        context,
      }
    }, [location.pathname, params, searchParamsObject, data, context])

    // 2. Handle Pruning Target
    // If THIS is the target, we render it but clear its children (the Outlet).
    const children = pruningTarget && name === pruningTarget ? null : <Outlet />

    return <__PYLON_INTERNALS_DO_NOT_USE.RouteDataProvider props={pageProps} name={name}>
      <Component {...(props as any)} {...pageProps} children={children} />
    </__PYLON_INTERNALS_DO_NOT_USE.RouteDataProvider>
  };
}

/**
 * Dynamically imports the Pylon server context.
 * * @description
 * This function uses a dynamic import with a variable (\`moduleNameToPreventBundling\`) 
 * to intentionally obscure the import path from bundlers like Webpack or Vite. 
 * This prevents the bundler from mistakenly attempting to include server-side 
 * Pylon code within the client-side bundle, which would cause build or runtime errors.
 * * @returns {Promise<{ app: any, ctx: any }>} The Pylon application instance and context.
 * @throws Will throw an error if executed in a browser environment where the module is unavailable.
 */
async function getPylonServerContext() {
  const moduleNameToPreventBundling = '@getcronit/pylon';
  const { app, getContext } = await import(moduleNameToPreventBundling);
  return { app, ctx: getContext() };
}

/**
 * Creates an isomorphic data loader for a specific route.
 * * @description
 * This factory function generates a loader capable of executing on both the server 
 * and the client. It handles environment detection, header propagation, and 
 * ensures the client stays synchronized with the server's application version.
 * * @param {string} [ref] - An optional route reference identifier passed to the server via the \`X-Pylon-Route-Ref\` header.
 * @returns {__PYLON_ROUTER_INTERNALS_DO_NOT_USE.LoaderFunction} An asynchronous loader function ready to handle requests.
 */
export const loader: (ref?: string) => __PYLON_ROUTER_INTERNALS_DO_NOT_USE.LoaderFunction = (ref) => async ({ request }) => {
  const url = new URL(request.url);
  const isJsonOnlyFetch = request.headers.get('accept')?.includes('application/json');

  // 1. Handle Client-Side Preloading
  // If the browser is pre-fetching route data (JSON only), we can bypass the full fetch
  // and return the context directly if we are already on the server.
  if (isJsonOnlyFetch) {
    try {
      const { ctx } = await getPylonServerContext();
      return { context: ctx.get('pagesContext') };
    } catch {
      // Safely catches if a browser inadvertently triggers this path.
      return null; 
    }
  }

  // 2. Environment Setup (Server vs. Browser)
  let fetcher: typeof fetch = fetch;
  const headers = new Headers();

  try {
    // Attempt Server-Side Setup
    // If successful, we swap the standard \`fetch\` for Pylon's internal request handler.
    const { app, ctx } = await getPylonServerContext();
    fetcher = app.request;

    // Propagate original request headers to maintain session/auth state
    for (const [key, value] of ctx.req.raw.headers.entries()) {
      headers.append(key, value);
    }
    
    // Prevent the server from returning compressed responses (like gzip) 
    // so our internal fetch can parse the JSON immediately.
    headers.set('Accept-Encoding', 'identity');
  } catch {
    // Fallback: Browser Environment
    // Standard \`fetch\` is used. The browser will automatically handle cookies and standard headers.
  }

  // 3. Attach Internal Pylon Routing Headers
  headers.set('Accept', 'application/json');
  headers.set('X-Pylon-Internal', 'true');
  if (ref) {
    headers.set('X-Pylon-Route-Ref', ref);
  }

  // 4. Execute Fetch
  const response = await fetcher(url.pathname + url.search, {
    method: 'GET',
    headers,
  });

  // 5. Process Response & Synchronization
  try {
    const data = await response.json<any>();

    // Client-Side Version Sync Check:
    // If the server returns a newer application version than what the client 
    // is currently running, force a hard reload to fetch the latest assets.
    if (typeof window !== 'undefined' && data?.version) {
      const clientVersion = (window as any).__PYLON_VERSION__;
      if (clientVersion && data.version !== clientVersion) {
        window.location.reload();
      }
    }

    return data;
    
  } catch (error) {
    console.error("Pylon Loader Error: Failed to parse JSON response.", error);
    return null;
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
