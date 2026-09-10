/**
 * Locale negotiation for usePages SSR — P1 of rfcs/SSR_I18N.md.
 *
 * The one rule that shapes everything: **negotiation never drives a redirect.**
 *
 * The pattern Next.js documents — read `Accept-Language` in middleware, redirect an
 * unprefixed URL to the negotiated locale — is actively harmful. Googlebot "sends HTTP
 * requests without setting `Accept-Language`", and independent measurement found Bingbot,
 * GPTBot, ClaudeBot and PerplexityBot generally don't either; when an AI crawler does send
 * one it is a hardcoded `en-US,en;q=0.9` default rather than user intent. A varying redirect
 * therefore lands every crawler on the default locale, and the other locales are only
 * partially discovered by search AND by LLM systems. Detecting bots to skip the redirect is
 * not a fix — that is cloaking. So pylon ships no redirect helper at all; this module only
 * ever *reports* a locale.
 */

export type LocaleRouting = 'cookie' | 'prefix'

/**
 * Whether the default locale gets a prefix of its own.
 *
 * `'as-needed'` (default) serves it unprefixed: `/pricing` is English, `/de/pricing` German.
 * That is not merely tidier — it removes the redirect trap by construction. Under
 * `'always'` there is a locale-less `/pricing` that must redirect somewhere, and choosing
 * that destination is exactly the decision `Accept-Language` cannot make (see the module
 * header). Under `'as-needed'` the unprefixed URL IS a real, canonical, indexable page, so
 * nothing is left to negotiate at.
 */
export type LocalePrefix = 'as-needed' | 'always'

export interface I18nOptions {
  /** Supported locales. The first request-provided match wins; order is not significant. */
  locales: readonly string[]
  /** Used when nothing else resolves. Must appear in `locales`. */
  defaultLocale: string
  /**
   * How the active locale is decided.
   *
   * - `'cookie'` — the cookie is authoritative, then `Accept-Language`, then the default.
   *   For AUTHENTICATED app UI only: it serves different content at one URL, so there is no
   *   second URL to canonicalise and a crawler sees a single-language site.
   * - `'prefix'` — the URL is authoritative (`/de/pricing`). Required for anything public.
   *
   * Defaults to `'prefix'`. Public content needs it: a cookie-only site serves several
   * languages at one URL, so there is no second URL to canonicalise and a crawler — which
   * sends neither cookies nor `Accept-Language` — only ever sees one language.
   */
  routing?: LocaleRouting
  /**
   * Prefix strategy for `routing: 'prefix'`. Default `'as-needed'`.
   *
   * Each mode owes one deterministic redirect so that only one URL per locale is canonical:
   * `'as-needed'` 301s `/en/pricing` → `/pricing`, `'always'` 301s `/pricing` →
   * `/en/pricing`. Deterministic, never negotiated.
   */
  prefix?: LocalePrefix
  /**
   * Directory holding the message catalogs, project-relative — `'./messages'`, containing
   * `en.ts`, `de.ts`, `fr.json`, one per configured locale.
   *
   * A PATH rather than pre-imported objects, because the path is what lets the build own
   * them: `usePages`'s build hook compiles each catalog into `.pylon/messages/<locale>.js`,
   * so they need not live under `src/` and an app never wires up imports by hand.
   *
   * SERVER-ONLY by design. Catalogs never enter the client bundle: the active locale's
   * messages travel in the hydration envelope as data, and switching locale is a document
   * navigation (see `<Link locale>`), so the browser never needs a second catalog. That is
   * what makes "only the active locale ships" true by construction rather than by bundler
   * configuration.
   */
  catalogs?: string
  /** Cookie carrying the locale. Default `'locale'`. */
  cookie?: string
}

/** What negotiation produced, exposed to pages and serialised for the client. */
export interface I18nContext {
  /** The locale this render must use. */
  locale: string
  locales: readonly string[]
  defaultLocale: string
  /**
   * Did the request state this locale, or did we fall back to the default?
   *
   * Drives cookie persistence: only persist a locale the visitor actually expressed.
   */
  localeWasExplicit: boolean
  /**
   * A DIFFERENT locale the request hints at — a cookie or `Accept-Language` disagreeing
   * with the URL. Never changes what is rendered; it exists so a layout can offer
   * "Auf Deutsch ansehen" and let the visitor choose. `undefined` when there is no
   * disagreement.
   *
   * This is the honest alternative to redirecting: the URL keeps one meaning, and the
   * suggestion is a link rather than a 302 that crawlers cannot follow correctly.
   */
  suggestedLocale?: string
  /**
   * React Router basename for this locale — `'/de'`, or `''` for the one served unprefixed.
   *
   * Computed HERE, server-side, and shipped in the hydration envelope so the browser uses
   * the same value rather than re-deriving it from config it would have to be told about.
   * Client and server cannot disagree about where routes are mounted.
   */
  basename: string
  /**
   * Every locale's basename, keyed by locale — `{en: '', de: '/de'}`.
   *
   * A language switcher has to build a URL for a locale that is NOT the active one, and
   * React Router's `basename` deliberately confines `<Link>` to the current one. Computing
   * the others in the browser would mean shipping `routing`/`prefix` config and duplicating
   * the rule; precomputing them here keeps one source of truth (the map is a handful of
   * short strings).
   */
  basenames: Record<string, string>
}

/**
 * Where this locale's routes are mounted. `''` means the site root.
 *
 * Only `prefix` routing produces a basename: in cookie mode every locale lives at the same
 * URLs, and in `as-needed` the default locale is the unprefixed site.
 */
export const basenameForLocale = (
  options: I18nOptions,
  locale: string
): string => {
  if ((options.routing ?? 'prefix') !== 'prefix') return ''
  const bare =
    (options.prefix ?? 'as-needed') === 'as-needed' &&
    normalise(locale) === normalise(options.defaultLocale)
  return bare ? '' : `/${locale}`
}

const normalise = (tag: string): string => tag.trim().toLowerCase()

/**
 * Is `candidate` a supported locale? Narrows `string`, so an unrecognised path segment can
 * be turned into a 404 rather than silently falling back — the behaviour Next's own i18n
 * guide recommends.
 */
export const hasLocale = <T extends string>(
  locales: readonly T[],
  candidate: string | undefined | null
): candidate is T =>
  typeof candidate === 'string' &&
  locales.some(l => normalise(l) === normalise(candidate))

/** Resolve a candidate against `locales`, preserving the configured casing. */
const resolve = (
  locales: readonly string[],
  candidate: string | undefined | null
): string | undefined =>
  typeof candidate === 'string'
    ? locales.find(l => normalise(l) === normalise(candidate))
    : undefined

/**
 * Best supported match for an `Accept-Language` header.
 *
 * Honours q-values and falls back from a region to its base language (`de-AT` → `de`), which
 * is what makes a browser sending `de-AT,de;q=0.9` land on a `de` catalog.
 *
 * This parses attacker-controllable input, so it never throws. It is also deliberately
 * LENIENT about a malformed weight: `de;q=NaN` keeps the tag at the default weight rather
 * than discarding it, because the client plainly asked for German and dropping the entry
 * would serve them the default locale instead. An explicit `q=0` is still a refusal.
 * The header is a hint, never a security boundary.
 */
export const matchAcceptLanguage = (
  locales: readonly string[],
  header: string | undefined | null
): string | undefined => {
  if (!header) return undefined

  const ranked = header
    .split(',')
    .map(part => {
      const [tag, ...params] = part.split(';').map(s => s.trim())
      const q = params
        .map(p => /^q=([0-9.]+)$/i.exec(p)?.[1])
        .find(Boolean)
      const quality = q === undefined ? 1 : Number.parseFloat(q)
      return {tag, quality: Number.isFinite(quality) ? quality : 0}
    })
    .filter(e => e.tag && e.quality > 0)
    .sort((a, b) => b.quality - a.quality)

  for (const {tag} of ranked) {
    if (tag === '*') return undefined // "anything" tells us nothing — use the default
    const exact = resolve(locales, tag)
    if (exact) return exact
    const base = resolve(locales, tag.split('-')[0])
    if (base) return base
  }
  return undefined
}

/**
 * Split a leading locale segment off a pathname.
 *
 * `/de/pricing` → `{locale: 'de', pathname: '/pricing'}`; `/pricing` → `{pathname:
 * '/pricing'}`. Only position 0 is ever a locale, which is why `/docs/de` and `/de/de` are
 * unambiguous — see the shadowing note in rfcs/SSR_I18N.md.
 */
export const splitLocalePath = (
  locales: readonly string[],
  pathname: string
): {locale?: string; pathname: string} => {
  const [, first = '', ...rest] = pathname.split('/')
  const locale = resolve(locales, first)
  if (!locale) return {pathname}
  return {locale, pathname: `/${rest.join('/')}`}
}

/** Every locale's basename, keyed by locale. */
export const allBasenames = (options: I18nOptions): Record<string, string> =>
  Object.fromEntries(options.locales.map(l => [l, basenameForLocale(options, l)]))

export interface NegotiateInput {
  pathname: string
  cookie?: string | null
  acceptLanguage?: string | null
}

/**
 * Decide the locale for one request. Pure — no headers written, no redirect, no I/O.
 *
 * In `'prefix'` mode the URL wins outright: there is no precedence chain, because an absent
 * prefix *is* the default locale. A cookie or `Accept-Language` that disagrees becomes
 * `suggestedLocale` rather than changing the render — serving German at the English URL
 * would give one URL two contents and make its canonical a lie.
 */
export const negotiate = (
  options: I18nOptions,
  input: NegotiateInput
): I18nContext => {
  const {locales, defaultLocale} = options
  const routing: LocaleRouting = options.routing ?? 'prefix'

  const fromCookie = resolve(locales, input.cookie)
  const fromHeader = matchAcceptLanguage(locales, input.acceptLanguage)

  if (routing === 'prefix') {
    const {locale: fromPath} = splitLocalePath(locales, input.pathname)
    const locale = fromPath ?? defaultLocale
    // A hint only counts as a suggestion when it disagrees with what we are rendering.
    const hint = fromCookie ?? fromHeader
    return {
      locale,
      locales,
      defaultLocale,
      localeWasExplicit: fromPath !== undefined,
      basename: basenameForLocale(options, locale),
      basenames: allBasenames(options),
      ...(hint && hint !== locale ? {suggestedLocale: hint} : {})
    }
  }

  // Cookie mode: no URL to be authoritative, so the request's own signals decide.
  const locale = fromCookie ?? fromHeader ?? defaultLocale
  return {
    locale,
    locales,
    defaultLocale,
    localeWasExplicit: fromCookie !== undefined || fromHeader !== undefined,
    basename: '',
    basenames: allBasenames(options)
  }
}

/**
 * Response headers whose value can change the rendered output, for `Vary`.
 *
 * Both modes need both. In cookie mode they decide the locale outright. In prefix mode the
 * URL decides the locale, but a cookie or `Accept-Language` still feeds `suggestedLocale` —
 * which is rendered, so a shared cache must not hand one visitor's suggestion to another.
 */
export const I18N_VARY: readonly string[] = ['Cookie', 'Accept-Language']

/**
 * The one redirect prefix routing owes, so exactly one URL per locale is canonical.
 *
 * `'as-needed'`: `/en/pricing` → `/pricing`. `'always'`: `/pricing` → `/en/pricing`.
 *
 * DETERMINISTIC — it depends only on the path and the config, never on a cookie or
 * `Accept-Language`. That distinction is the whole point: a predictable redirect is fine for
 * crawlers (they follow it and index the target), while a *varying* one sends every crawler
 * to the default locale because they send neither signal. Returns `undefined` when the URL is
 * already canonical, which is the common case.
 */
export const canonicalRedirect = (
  options: I18nOptions,
  pathname: string
): string | undefined => {
  if ((options.routing ?? 'prefix') !== 'prefix') return undefined
  const {locale, pathname: rest} = splitLocalePath(options.locales, pathname)
  const asNeeded = (options.prefix ?? 'as-needed') === 'as-needed'
  const isDefault = locale !== undefined && normalise(locale) === normalise(options.defaultLocale)

  // as-needed: the default locale must not carry a prefix.
  if (asNeeded && isDefault) return rest === '/' ? '/' : rest

  // always: every locale must carry one, so an unprefixed path gains the default's.
  if (!asNeeded && locale === undefined) {
    return `/${options.defaultLocale}${pathname === '/' ? '' : pathname}`
  }

  return undefined
}

/** One `<link rel="alternate" hreflang>` entry. */
export interface LocaleAlternate {
  hreflang: string
  href: string
}

export interface LocaleUrls {
  /** Absolute URL of this page in each locale, keyed by locale. */
  byLocale: Record<string, string>
  /** The full alternate cluster, including `x-default`. */
  alternates: LocaleAlternate[]
}

/**
 * Absolute URLs for this page in every locale, plus the hreflang cluster.
 *
 * `pathname` is the route path WITHOUT any locale basename (`/pricing`), because that is the
 * one thing every locale shares. Each locale's URL is then built from ITS basename.
 *
 * Deliberately computed per locale rather than "the same path under a different prefix": if
 * translated slugs land later (`/de/kontakt` for `/contact` — see the RFC), only the mapping
 * from locale to path changes, not the emitter or its callers.
 *
 * hreflang requires ABSOLUTE URLs, which is why `origin` is configuration rather than
 * something derived from the request: behind a proxy the Host header is attacker-influenced,
 * and a canonical built from a spoofed host points search engines at someone else's domain.
 */
export const localeUrls = (
  options: I18nOptions,
  origin: string,
  pathname: string
): LocaleUrls => {
  const base = origin.replace(/\/$/, '')
  // `/` contributes nothing, so `/de` + `/` stays `/de` rather than becoming `/de/` — a
  // distinct URL to a crawler, and not the one the trailing-slash middleware serves.
  const suffix = pathname === '/' ? '' : pathname

  const urlFor = (locale: string): string => {
    const url = `${base}${basenameForLocale(options, locale)}${suffix}`
    // The site root still needs a path.
    return url === base ? `${base}/` : url
  }

  const byLocale = Object.fromEntries(options.locales.map(l => [l, urlFor(l)]))

  return {
    byLocale,
    alternates: [
      ...options.locales.map(l => ({hreflang: l, href: byLocale[l]})),
      // Whom to serve when no listed language matches: the default locale's version.
      {hreflang: 'x-default', href: byLocale[options.defaultLocale]}
    ]
  }
}

/** One locale's sitemap entry: its own `<loc>` plus the shared alternate cluster. */
export interface LocalizedSitemapEntry {
  loc: string
  alternates: LocaleAlternate[]
}

/**
 * Expand one declared sitemap URL into one entry PER LOCALE.
 *
 * A sitemap that lists only `/pricing` tells search engines the other locales do not exist —
 * discovery of `/de/pricing` would then depend entirely on it being linked from somewhere.
 * Google's format gives every locale its own `<url>`, each repeating the full alternate set,
 * which is the sitemap equivalent of the bidirectional `<head>` cluster.
 *
 * Returns `undefined` when the URL ALREADY carries a locale prefix: the app said exactly
 * which URL it meant, so expanding it would invent siblings it did not ask for. That is also
 * the per-URL opt-out.
 */
export const localizeSitemapUrl = (
  options: I18nOptions,
  origin: string,
  url: string
): LocalizedSitemapEntry[] | undefined => {
  if ((options.routing ?? 'prefix') !== 'prefix') return undefined

  // Accept an absolute URL or a bare path; we only care about the path.
  let pathname: string
  try {
    pathname = /^https?:\/\//.test(url) ? new URL(url).pathname : url
  } catch {
    return undefined
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`

  // Already localized — respect it verbatim.
  if (splitLocalePath(options.locales, pathname).locale !== undefined) return undefined

  const {byLocale, alternates} = localeUrls(options, origin, pathname)
  return options.locales.map(l => ({loc: byLocale[l], alternates}))
}
