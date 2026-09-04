import {Link as LinkComp, LinkProps as LinkCompProps, useLocation} from 'react-router'
import {useDataClient} from './internals'

interface LinkProps extends Omit<LinkCompProps, 'to'> {
  href?: LinkCompProps['to']
  /**
   * Link into a DIFFERENT locale — the language switcher.
   *
   * `<Link locale="de">Deutsch</Link>` points at the current page in German;
   * `<Link href="/pricing" locale="de">` at a specific one. Omit it and this is an ordinary
   * link, which already stays inside the active locale because React Router's `basename`
   * resolves it (`/pricing` on `/de` is `/de/pricing`).
   *
   * Crossing locales renders a plain `<a>`, i.e. a full document navigation, ON PURPOSE. A
   * client-side transition would keep everything the server rendered in the OLD language:
   * `<html lang>`, SSR-resolved copy, and the hydration envelope would all still be the
   * previous locale. The other language is a different document, so it is fetched as one.
   */
  locale?: string
}

/**
 * React Router props that mean nothing to a bare `<a>` — spreading them would emit invalid
 * DOM attributes and warn.
 */
const ROUTER_ONLY = [
  'replace',
  'state',
  'preventScrollReset',
  'relative',
  'reloadDocument',
  'viewTransition',
  'discover',
  'prefetch',
  'unstable_viewTransition'
] as const

export const Link: React.FC<LinkProps> = props => {
  const {href, locale, ...rest} = props
  const i18n = useDataClient().i18n
  // Basename-relative on BOTH sides: React Router strips it, so `/de/pricing` is `/pricing`
  // here. That is exactly the path to re-prefix with another locale's basename.
  const location = useLocation()

  const target =
    locale !== undefined && i18n && locale !== i18n.locale
      ? (i18n.basenames as Record<string, string> | undefined)?.[locale]
      : undefined

  // `target` is undefined for a same-locale link, no i18n, or an unconfigured locale — the
  // last of which falls through to a normal link rather than emitting a broken URL.
  if (target !== undefined) {
    const path = typeof href === 'string' ? href : location.pathname
    const anchorProps: Record<string, unknown> = {...rest}
    for (const p of ROUTER_ONLY) delete anchorProps[p]

    return (
      <a
        href={`${target}${path === '/' ? '' : path}` || '/'}
        hrefLang={locale}
        {...anchorProps}
      />
    )
  }

  return <LinkComp to={href ?? ''} {...rest} />
}
