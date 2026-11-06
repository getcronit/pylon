export * as __PYLON_ROUTER_INTERNALS_DO_NOT_USE from 'react-router'
export * as __PYLON_INTERNALS_DO_NOT_USE from './internals'

import {
  useNavigate as __useRouterNavigate,
  useInRouterContext
} from 'react-router'
import {navigate, setPrimaryNavigate} from './window-navigate'

export {Image} from './image'
export {
  useRouteData,
  useResponseCookies,
  useLocale,
  useTranslations,
  useFormatter
} from './internals'
export {setMessageFormatter} from '../plugins/use-pages/catalog'
export type {
  SameShape,
  Messages,
  PluralMessage,
  PluralCategory
} from '../plugins/use-pages/catalog'


export type {
  ResponseCookies,
  ResponseCookieOptions
} from './response-cookies'
export {Link} from './link'
/**
 * The pages version, which ORs the router's navigation state with the query
 * client's in-flight set — see the hook for why either alone leaves a gap.
 * `@getcronit/pylon` exports a query-only `useIsFetching` for non-routed apps.
 */
export {useIsFetching} from './use-is-fetching'
export type {UseIsFetchingOptions} from '@/query'
export {
  ErrorBoundary,
  type ErrorBoundaryProps,
  type ErrorFallbackRender
} from './error-boundary'

export * from '@/pages/components/dev-overlay'
export {default as GlobalErrorPage} from '@/pages/components/global-error-page'
export {StatusPage} from '@/pages/components/status-page'
export {
  type Data,
  type Mutations,
  type LayoutProps,
  type MetadataRoute,
  type PageProps
} from '@/pages/plugins/use-pages'

import '../globals.css'

export * from './gid'
export * from './http'
export * from './use-data'
export * from './use-mutation'
export {op, type Op} from './op'

/** The React Router client hooks the app uses, re-exported BY NAME so pages import them from
 * '@getcronit/pylon/pages' instead of the __PYLON_ROUTER_INTERNALS_DO_NOT_USE escape hatch. These are
 * RR's own hooks verbatim — inside a page/pane (always a <Router>) they just work. (`redirect` is NOT
 * here: Pylon has its own in ./http.) */
export {useLocation, useParams, useSearchParams, useBlocker} from 'react-router'

/**
 * Navigation that works both INSIDE a page/pane (a `<Router>`) and ABOVE the pane stack (the app
 * shell, dialogs, the task sheet). React Router's own `useNavigate` throws outside a `<Router>`, so
 * this detects router membership and falls back to the primary pane's navigate there. A component's
 * router membership is fixed for its lifetime, so the branch — and thus the hook order — is stable
 * across renders. For plain, non-hook call sites use the imperative `navigate()` instead.
 */
export function useNavigate(): ReturnType<typeof __useRouterNavigate> | typeof navigate {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (useInRouterContext()) return __useRouterNavigate()
  return navigate
}

/** Window-Navigate: the imperative `navigate()` + the hydration seed. See './window-navigate'. */
export {navigate, setPrimaryNavigate}
