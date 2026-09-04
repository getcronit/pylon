import fs from 'fs'
import path from 'path'

const PAGES_DIR = './pages'

/** One-shot guard so the "no root error.tsx" warning fires once per process, not per dev rebuild. */
let hasWarnedNoRootError = false

/**
 * Interface representing a route configuration.
 */
export interface Route {
  id?: string
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
  /** Root `pages/error.tsx` component, if any (drives the "no root error boundary" warning). */
  rootError?: string
  /** Root `pages/not-found.tsx` component, if any (used for the top-level catch-all). */
  rootNotFound?: string
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
 * Converts a file path to a corresponding error-boundary component name.
 *
 * `error.tsx` alongside a `layout.tsx`/`page.tsx` lets an app override the default
 * error UI for that route segment. The suffix is `ErrorBoundary` (not `Error`) on
 * purpose: a bare `Error` binding would shadow the global `Error` constructor in the
 * generated module.
 * @param filePath - The file path to convert.
 * @returns The generated error-boundary component name.
 */
export function getErrorComponentName(filePath: string): string {
  const segments = filePath
    .replace(PAGES_DIR, '')
    .replace(/\\/g, '/')
    .replace(/error\.tsx$/, '')
    .split('/')
    .filter(Boolean)

  return (segments.map(formatSegment).join('') || 'Root') + 'ErrorBoundary'
}

/**
 * Converts a file path to a corresponding not-found component name.
 *
 * `not-found.tsx` alongside a `layout.tsx`/`page.tsx` overrides the default 404 UI for
 * that segment (and cascades to nested segments, like `error.tsx`).
 * @param filePath - The file path to convert.
 * @returns The generated not-found component name.
 */
export function getNotFoundComponentName(filePath: string): string {
  const segments = filePath
    .replace(PAGES_DIR, '')
    .replace(/\\/g, '/')
    .replace(/not-found\.tsx$/, '')
    .split('/')
    .filter(Boolean)

  return (segments.map(formatSegment).join('') || 'Root') + 'NotFound'
}

/**
 * Converts a file path to a corresponding loading component name.
 *
 * `loading.tsx` alongside a `layout.tsx`/`page.tsx` provides the segment's Suspense
 * fallback (and cascades to nested segments, like `error.tsx`/`not-found.tsx`). It is
 * wired as the route's `HydrateFallback` and as a CLIENT-ONLY Suspense boundary around
 * the segment's page (see `withLoading` in the generated module) — Phase 1 keeps SSR
 * boundary-free so the buffered HTML carries resolved content, not the fallback.
 * @param filePath - The file path to convert.
 * @returns The generated loading component name.
 */
export function getLoadingComponentName(filePath: string): string {
  const segments = filePath
    .replace(PAGES_DIR, '')
    .replace(/\\/g, '/')
    .replace(/loading\.tsx$/, '')
    .split('/')
    .filter(Boolean)

  return (segments.map(formatSegment).join('') || 'Root') + 'Loading'
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
 * Build the `<ErrorElement/>` JSX for a route. `error` is the segment's `error.tsx`
 * (custom crash UI); `notFound` is its `not-found.tsx` (custom 404, used when a route
 * THROWS `notFound()` — that becomes a 404 the errorElement handles, distinct from the
 * unmatched-path catch-all). Both optional; absent falls back to the built-ins.
 */
function buildErrorElement(
  standalone: boolean,
  error?: string,
  notFound?: string
): string {
  const props = [`standalone={${standalone}}`]
  if (error) props.push(`component={${error}}`)
  if (notFound) props.push(`notFound={${notFound}}`)
  return `<ErrorElement ${props.join(' ')} />`
}

/**
 * Processes a layout file and updates the route configuration.
 */
function processLayoutItem(
  relativePath: string,
  importPath: string,
  route: Route,
  context: ScanContext,
  errorComponentName?: string,
  notFoundComponentName?: string,
  loadingComponentName?: string
): void {
  const layoutComponentName = getLayoutComponentName(relativePath)
  context.imports.push(`import ${layoutComponentName} from ${importPath};`)

  const componentName =
    layoutComponentName === 'Layout' ? `RootLayout` : `${layoutComponentName}`

  const catchAllParam = relativePath.match(/\[\.\.\.(.+)\]/)?.[1]
  const paramMatches = [...relativePath.matchAll(/\[(.+?)\]/g)].map(m =>
    m[1].replace('...', '')
  )

  route.id = componentName
  route.Component = `withRouteData((props) => <${componentName} children={<Outlet />} {...props} />, "${componentName}", ${catchAllParam ? `"${catchAllParam}"` : 'undefined'})`
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

  // Every layout owns an error boundary, not just the root. Without one, a failure
  // in a nested layout (e.g. a `useData` whose upstream is down) has no nearby
  // boundary and bubbles to the ROOT layout's `standalone` element — turning one
  // dead query into a whole-document outage across every route under that layout.
  // A per-layout boundary contains the failure to its own subtree: the parent chrome
  // stays rendered, the error shows in the parent's `<Outlet />`. The root stays
  // `standalone` (it IS the document, so there is no parent chrome to preserve).
  // A sibling `error.tsx` / `not-found.tsx` overrides the default UI for this segment.
  const isRoot = route.path === '/'
  route.errorElement = buildErrorElement(
    isRoot,
    errorComponentName,
    notFoundComponentName
  )

  // The segment's `loading.tsx` (own or inherited) is the hydration fallback; the built-in
  // `HydrateFallback` is the default when none is defined.
  route.HydrateFallback = loadingComponentName ?? 'HydrateFallback'
}

/**
 * Processes a page file and adds it to the route children.
 */
function processPageItem(
  relativePath: string,
  importPath: string,
  route: Route,
  errorComponentName?: string,
  notFoundComponentName?: string,
  loadingComponentName?: string
): void {
  const catchAllParam = relativePath.match(/\[\.\.\.(.+)\]/)?.[1]
  const pageComponentName = getPageComponentName(relativePath)

  // The page IS the segment's leaf element, so its `loading.tsx` (own or inherited) wraps
  // it in a CLIENT-ONLY Suspense boundary (see `withLoading`): the navigation loading state
  // on the client, while SSR stays boundary-free so the buffered HTML carries resolved
  // content. `withRouteData` first, then `withLoading` around it.
  const componentExpr = `withRouteData(i.default, "${pageComponentName}", ${catchAllParam ? `"${catchAllParam}"` : 'undefined'})`
  const wrappedComponentExpr = loadingComponentName
    ? `withLoading(${componentExpr}, ${loadingComponentName})`
    : componentExpr

  route.children!.push({
    id: pageComponentName,
    path: undefined,
    index: true,
    errorElement: buildErrorElement(false, errorComponentName, notFoundComponentName),
    lazy: `async () => {const i = await import(${importPath}).catch((e) => {console.error("[pylon] failed to load route module", ${importPath}, e); if (typeof window !== 'undefined') { window.location.reload(); return new Promise(() => {}); } throw e;}); return {Component: ${wrappedComponentExpr}}}`,
    HydrateFallback: loadingComponentName ?? 'HydrateFallback'
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
  basePath: string = '',
  inheritedError?: string,
  inheritedNotFound?: string,
  inheritedLoading?: string
): Route | null {
  const items = fs.readdirSync(directory, {withFileTypes: true})
  const route: Route = {path: basePath || '/', children: []}
  let hasLayout = false
  let pageFound = false

  // Sibling `error.tsx` / `not-found.tsx` set the error / 404 UI for THIS segment AND
  // cascade to every nested segment that doesn't define its own — Next.js semantics.
  // Put one at the root and the whole app inherits it; override deeper by adding another.
  // WITHOUT the cascade, each layout would keep the default and adding a route would
  // silently drop back to it in production (not a build error). So a segment's component
  // is: its own file, else the nearest ancestor's (the `inherited*` args), else the
  // built-in default. A file is imported whenever it can guard something — a route here
  // or descendants to cascade to.
  const fileNames = new Set(items.filter(i => i.isFile()).map(i => i.name))
  const hasChildDir = items.some(i => i.isDirectory())
  const canGuard =
    fileNames.has('layout.tsx') || fileNames.has('page.tsx') || hasChildDir
  const detect = (
    fileName: string,
    getName: (rel: string) => string
  ): string | undefined => {
    if (!fileNames.has(fileName) || !canGuard) return undefined
    const rel = path.join(basePath, fileName).replace(/\\/g, '/')
    const imp = `"./${path.join('..', PAGES_DIR, rel).replace(/\.tsx$/, '')}"`
    const name = getName(rel)
    context.imports.push(`import ${name} from ${imp};`)
    return name
  }
  const ownError = detect('error.tsx', getErrorComponentName)
  const ownNotFound = detect('not-found.tsx', getNotFoundComponentName)
  const ownLoading = detect('loading.tsx', getLoadingComponentName)
  // This segment's components, and what its descendants inherit.
  const errorComponentName = ownError ?? inheritedError
  const notFoundComponentName = ownNotFound ?? inheritedNotFound
  const loadingComponentName = ownLoading ?? inheritedLoading
  // Record the ROOT files: `rootError` drives the "no root error boundary" warning,
  // `rootNotFound` feeds the top-level catch-all in makeAppFiles.
  if (basePath === '') {
    context.rootError = ownError
    context.rootNotFound = ownNotFound
  }

  for (const item of items) {
    const itemPath = path.join(directory, item.name)
    const relativePath = path.join(basePath, item.name).replace(/\\/g, '/')
    const importPath = `"./${path
      .join('..', PAGES_DIR, relativePath)
      .replace(/\.tsx$/, '')}"`

    if (item.isDirectory()) {
      const childRoute = scanDirectory(
        itemPath,
        context,
        relativePath,
        errorComponentName,
        notFoundComponentName,
        loadingComponentName
      )
      if (childRoute) {
        route.children!.push(childRoute)
      }
    } else if (item.name === 'layout.tsx') {
      processLayoutItem(
        relativePath,
        importPath,
        route,
        context,
        errorComponentName,
        notFoundComponentName,
        loadingComponentName
      )
      hasLayout = true
    } else if (item.name === 'page.tsx') {
      processPageItem(
        relativePath,
        importPath,
        route,
        errorComponentName,
        notFoundComponentName,
        loadingComponentName
      )
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
      id: `${route.id}/NotFound`,
      path: '*',
      element: notFoundComponentName
        ? `<${notFoundComponentName} />`
        : '<NotFoundPage standalone={false} />',
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

import {useMemo, Suspense} from 'react'
import {__PYLON_ROUTER_INTERNALS_DO_NOT_USE, __PYLON_INTERNALS_DO_NOT_USE, GlobalErrorPage, StatusPage} from '@getcronit/pylon/pages'
const Outlet = __PYLON_ROUTER_INTERNALS_DO_NOT_USE.Outlet

const ErrorElement: React.FC<{standalone: boolean, component?: React.ComponentType<{error: Error, reset: () => void}>, notFound?: React.ComponentType}> = ({standalone, component: UserErrorBoundary, notFound: UserNotFound}) => {
  // Destructure for cleaner code
  const { useRouteError, isRouteErrorResponse, Navigate } = __PYLON_ROUTER_INTERNALS_DO_NOT_USE;

  const error = useRouteError();
  console.error(error);

  let message = 'An unexpected error occurred.';

  // 1. Handle raw Response redirects (e.g., thrown directly during client render)
  if (
    error instanceof Response && 
    error.status >= 300 && 
    error.status < 400 && 
    error.headers.get('Location')
  ) {
    return <Navigate to={error.headers.get('Location')!} replace />;
  }

  // 2. Use the official router check for handled data errors (404, 401, etc.)
  // We check \`error.internal\` as a fallback just in case the server formatting is slightly off
  const isRouteError = isRouteErrorResponse(error)

  if (isRouteError) {
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

    // A thrown \`notFound()\` surfaces here as a 404 (distinct from an unmatched
    // path, which the catch-all route's \`element\` renders). When an app catch-all
    // matches every path, this is the ONLY way a 404 happens — so the segment's
    // \`not-found.tsx\` must be honored here, not just on the unmatched-path route.
    if ((error as any).status === 404 && UserNotFound) {
      return <UserNotFound />;
    }

    // Only render the StatusPage for non-500 HTTP errors
    if ((error as any).status !== 500) {
      return (
        <StatusPage
          code={(error as any).status}
          message={message}
          error={error}
          standalone={standalone}
        />
      );
    }
  }

  // 3. Fallback for standard code crashes (e.g., TypeError) and explicit 500s
  const displayError = error instanceof Error
    ? error
    : new Error(
        message ||
        (error && typeof error === 'object' && ((error as any).message || (error as any).statusText)) ||
        'A critical error occurred'
      );

  // A segment's \`error.tsx\` (passed as \`component\`) owns the crash UI, but only for
  // genuine crashes — redirects and handled HTTP statuses (404/403) are framework
  // concerns handled above, so the user boundary never sees them. \`reset\` re-runs the
  // failed render from a clean slate; a full reload is the one recovery guaranteed to
  // drop the cached read error and refetch (client-only — a no-op during SSR).
  if (UserErrorBoundary) {
    const reset = () => { if (typeof window !== 'undefined') window.location.reload(); };
    return <UserErrorBoundary error={displayError as any} reset={reset} />;
  }

  return <GlobalErrorPage error={displayError as any} standalone={standalone} />;
}

const HydrateFallback = () => {
  return <div>Loading...</div>
}

// Wrap a route's page component in its segment's \`loading.tsx\` Suspense fallback.
// CLIENT-ONLY by design (Phase 1): on the server we render the component directly so a
// suspending \`useData\` escalates to the shell — the buffered SSR HTML then carries the
// resolved content (never the fallback) and a thrown \`notFound()\` stays a real 404. On the
// client the Suspense boundary provides the navigation loading state. (Phase 4 / streaming
// is what would make this boundary active server-side; see rfcs/PAGES_STREAMING.md.)
function withLoading(Component: React.ComponentType<any>, Loading: React.ComponentType) {
  if (!Loading) return Component
  return function WithLoading(props: any) {
    if (typeof window === 'undefined') return <Component {...props} />
    return (
      <Suspense fallback={<Loading />}>
        <Component {...props} />
      </Suspense>
    )
  }
}

// Replaced pageClientCache with central cache in DataClientProvider

function withRouteData(Component: React.ComponentType<any>, id?: string, catchAllParam?: string) {
  return function WithRouteDataWrapper(props: any) {
    const dataClient = __PYLON_INTERNALS_DO_NOT_USE.useDataClient()
    const pagesContext = dataClient.pagesContext

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

    const pageProps = useMemo(() => {
      return {
        path: location.pathname,
        params,
        searchParams: searchParamsObject,
        context: pagesContext,
      }
    }, [location.pathname, params, searchParamsObject, pagesContext])

    return (
      <__PYLON_INTERNALS_DO_NOT_USE.RouteDataProvider props={pageProps} name={id}>
        <Component {...(props as any)} {...pageProps} children={<Outlet />} />
      </__PYLON_INTERNALS_DO_NOT_USE.RouteDataProvider>
    )
  };
}





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
  return <StatusPage code={404} message="The page you are looking for does not exist." standalone={standalone} />
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

  // A root `pages/error.tsx` is the one boundary that catches render errors app-wide
  // (it cascades to every segment). Without it, an uncaught error falls back to the
  // built-in error page — and since a missing boundary is not a build error, that
  // fallback reappears silently. Warn once per process (dev re-runs this per rebuild),
  // so it's a decision, not an accident, without spamming the dev loop.
  if (rootRoute && !context.rootError && !hasWarnedNoRootError) {
    hasWarnedNoRootError = true
    console.warn(
      '[pylon] No root `pages/error.tsx` found — uncaught render errors will use the ' +
        'built-in error page. Add `pages/error.tsx` to define your own app-wide error UI ' +
        '(it cascades to every route; override per-segment with a nested `error.tsx`).'
    )
  }

  const notFoundRoute: Route = {
    id: 'NotFound',
    path: '*',
    // The top-level catch-all (no route matched at all): a root `not-found.tsx` if the
    // app defines one, else the built-in 404 page.
    element: context.rootNotFound
      ? `<${context.rootNotFound} />`
      : '<NotFoundPage standalone={true} />',
    loader: '() => { return new Response("Not Found", { status: 404 }) }'
  }

  const routes = generateRouteFileContent(context, rootRoute, notFoundRoute)
  const slugs = `export default ${JSON.stringify(context.routeSlugs, null, 2)}`

  return {
    routes,
    slugs
  }
}
