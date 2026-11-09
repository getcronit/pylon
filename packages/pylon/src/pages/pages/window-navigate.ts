import type {NavigateOptions, To} from 'react-router'

/**
 * Window-level navigation for code that runs ABOVE the pane routers — the app shell, dialogs, the
 * task sheet, and the framework's own `redirect()` (see ./http). Those have no React Router context,
 * so instead of a hook they drive the PRIMARY pane's navigate through this module-level reference,
 * which the hydration bootstrap seeds exactly once via `setPrimaryNavigate`. This is the
 * framework-internal handle that fully replaces the former `window.__PYLON_NAVIGATE__` global.
 */

type PrimaryNavigate = (to: To, opts?: NavigateOptions) => void

let primaryNavigate: PrimaryNavigate | null = null

/** Seed the primary pane's navigate. Called once by the hydration bootstrap. @internal */
export function setPrimaryNavigate(fn: PrimaryNavigate | null): void {
  primaryNavigate = fn ?? null
}

/** The current primary-pane navigate, or null before hydration. @internal */
export function getPrimaryNavigate(): PrimaryNavigate | null {
  return primaryNavigate
}

/**
 * Imperative navigation usable ANYWHERE, including outside a `<Router>` (the app shell, dialogs, the
 * task sheet). Drives the primary pane's navigate once the app has hydrated; before that (or with no
 * router host at all, e.g. SSR) it falls back to a full-document navigation so a redirect still lands.
 * Inside a page/pane prefer `useNavigate()`/`<Link>`.
 */
export function navigate(to: To, opts?: NavigateOptions): void {
  if (primaryNavigate) {
    primaryNavigate(to, opts)
    return
  }

  if (typeof window !== 'undefined' && typeof to === 'string') {
    if (opts && opts.replace) window.location.replace(to)
    else window.location.assign(to)
  }
}
