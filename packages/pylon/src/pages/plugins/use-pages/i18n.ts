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
   * Defaults to `'cookie'` in this phase. Locale ROUTING — mounting the route tree under a
   * locale segment on both server and client — lands with a later phase, and `'prefix'`
   * becomes the default then.
   */
  routing?: LocaleRouting
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
  const routing: LocaleRouting = options.routing ?? 'cookie'

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
      ...(hint && hint !== locale ? {suggestedLocale: hint} : {})
    }
  }

  // Cookie mode: no URL to be authoritative, so the request's own signals decide.
  const locale = fromCookie ?? fromHeader ?? defaultLocale
  return {
    locale,
    locales,
    defaultLocale,
    localeWasExplicit: fromCookie !== undefined || fromHeader !== undefined
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
