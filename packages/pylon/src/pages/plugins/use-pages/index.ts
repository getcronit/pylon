import type {Plugin} from '@getcronit/pylon'
export type {Data, Mutations, LayoutProps, MetadataRoute, PageProps, PagesContext} from './types'
// `matchAcceptLanguage` / `splitLocalePath` stay internal — negotiation plumbing, not
// app-facing API. Their tests import them from source directly.
export {hasLocale} from './i18n'
export type {I18nOptions, I18nContext, LocaleRouting, LocalePrefix} from './i18n'
export type {SameShape, CatalogSource, Messages} from './catalog'

import type {I18nOptions} from './i18n'

export interface UsePagesOptions {
  /**
   * Wire `@sentry/react` into the client hydration bundle for error reporting.
   * Opt-in — when enabled the app must have `@sentry/react` installed. Defaults
   * to `false`; disabled apps get a plain console error handler and never import
   * Sentry.
   */
  sentry?: boolean
  /**
   * Locale negotiation for SSR. Opt-in: omitted, nothing about i18n runs.
   *
   * Negotiation NEVER redirects — see `./i18n.ts` for why that matters for search and AI
   * crawlers. The result reaches pages as `useLocale()` and is serialised for hydration, so
   * the client cannot disagree with the server.
   */
  i18n?: I18nOptions
  /**
   * Absolute site origin, e.g. `https://example.com` — enables `<link rel="canonical">` and,
   * with `i18n`, the `hreflang` cluster.
   *
   * Configuration rather than something derived from the request: both tags require absolute
   * URLs, and behind a proxy the Host header is attacker-influenced — a canonical built from
   * a spoofed host points search engines at someone else's domain.
   */
  origin?: string
}

export function usePages(options: UsePagesOptions = {}): Plugin {
  return {
    name: 'pages',
    strategy: 'last',
    // Readable by `pylon dev`, which needs to know about `i18n` before it stands up the
    // client Vite — and cannot otherwise see options captured in this closure.
    options,
    // We use async functions here so React isn't imported until setup() is called
    setup: async api => {
      const {setup} = await import('./setup')
      return setup(api, options)
    },
    build: async api => {
      const {build} = await import('./build')
      return build(api, options)
    }
  }
}
