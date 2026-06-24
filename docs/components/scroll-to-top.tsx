import {useEffect} from 'react'
import {__PYLON_ROUTER_INTERNALS_DO_NOT_USE as Router} from '@getcronit/pylon-pages'

/**
 * React Router does not reset scroll on client-side navigation. This restores the
 * expected behavior: jump to the top of the page whenever the path changes.
 *
 * The jump is forced `instant` so it overrides the global `scroll-behavior: smooth`
 * (which is meant for in-page anchor / table-of-contents links) — a smooth scroll
 * here gets cancelled by the incoming route's content swap and never reaches the top.
 * Hash-only changes keep their scroll, so anchor links still glide smoothly.
 */
export function ScrollToTop() {
  const {pathname} = Router.useLocation()

  useEffect(() => {
    // Stop the browser from restoring the previous page's scroll on top of ours.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  }, [])

  useEffect(() => {
    window.scrollTo({top: 0, left: 0, behavior: 'instant' as ScrollBehavior})
  }, [pathname])

  return null
}
