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
  /**
   * Emit `<link rel="canonical">`. On by default; set `false` to own it yourself.
   *
   * The default is right for most sites: the canonical is the page's own URL, and
   * a self-referencing one is always safe. It is a GUESS, though — derived from
   * the request path — and there are two things the framework cannot know:
   *
   *   - which query parameters matter. `?page=2` is a different set of items and
   *     belongs in the canonical; `?colour=red` is a filtered view of the same set
   *     and does not. Both look identical from here.
   *   - that two routes serve one thing, so one should point at the other.
   *
   * Rendering your own alongside this does NOT work: React appends `<link>` to
   * `<head>` rather than replacing, and it does not deduplicate by `id` or `key`,
   * so you get two — and search engines discard conflicting canonicals outright.
   * Hence a flag rather than an override.
   *
   * Turning it off does not affect `hreflang`, which stays with `i18n` because
   * locale basenames are something the framework does know. If you take the
   * canonical over, keep it consistent with those alternates: a page that
   * canonicalises elsewhere while advertising them contradicts itself.
   */
  canonical?: boolean
}

export function usePages(options: UsePagesOptions = {}): Plugin {
  return {
    name: 'pages',
    strategy: 'last',
    // Frontend/SSR is a WEB-role concern. In a worker (PYLON_ROLE=worker) executeConfig skips
    // this plugin, so its `setup` never runs — React/react-router/pylon-query and the page
    // manifests never import in the worker process (nor its standalone trace). The `build`
    // hook is unaffected (build has no run-role).
    roles: ['web'],
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
