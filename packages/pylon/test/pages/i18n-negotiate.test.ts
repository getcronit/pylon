import {describe, expect, it} from 'vitest'
import {
  basenameForLocale,
  canonicalRedirect,
  hasLocale,
  localeUrls,
  localizeSitemapUrl,
  matchAcceptLanguage,
  negotiate,
  splitLocalePath,
  type I18nOptions
} from '../../src/pages/plugins/use-pages/i18n'

const LOCALES = ['en', 'de', 'fr'] as const
const cookieMode: I18nOptions = {
  locales: LOCALES,
  defaultLocale: 'en',
  routing: 'cookie'
}
const prefixMode: I18nOptions = {
  locales: LOCALES,
  defaultLocale: 'en',
  routing: 'prefix'
}

describe('matchAcceptLanguage', () => {
  it('picks an exact supported tag', () => {
    expect(matchAcceptLanguage(LOCALES, 'de')).toBe('de')
  })

  it('falls back from a region to its base language', () => {
    // A browser set to Austrian German must still get the `de` catalog.
    expect(matchAcceptLanguage(LOCALES, 'de-AT')).toBe('de')
  })

  it('honours q-values rather than taking the first entry', () => {
    expect(matchAcceptLanguage(LOCALES, 'fr;q=0.2,de;q=0.9')).toBe('de')
  })

  it('skips unsupported tags to reach a supported one', () => {
    expect(matchAcceptLanguage(LOCALES, 'ja,ko;q=0.9,fr;q=0.5')).toBe('fr')
  })

  it('ignores entries explicitly refused with q=0', () => {
    expect(matchAcceptLanguage(LOCALES, 'de;q=0')).toBeUndefined()
  })

  it('treats `*` as no information', () => {
    expect(matchAcceptLanguage(LOCALES, '*')).toBeUndefined()
  })

  it('returns undefined for an absent header — the crawler case', () => {
    // Googlebot, GPTBot and ClaudeBot generally send no Accept-Language at all. Nothing
    // may be inferred from that; the caller falls back to the default.
    expect(matchAcceptLanguage(LOCALES, undefined)).toBeUndefined()
    expect(matchAcceptLanguage(LOCALES, '')).toBeUndefined()
  })

  it('does not throw on malformed input', () => {
    // Attacker-controllable header.
    expect(() => matchAcceptLanguage(LOCALES, ';;;q=;,,,')).not.toThrow()
    expect(matchAcceptLanguage(LOCALES, ';;;q=;,,,')).toBeUndefined()
  })

  it('keeps a tag whose weight is malformed, rather than discarding it', () => {
    // Deliberately lenient: the client plainly asked for German, so an unparseable weight
    // should not demote them to the default locale. An explicit q=0 is still a refusal.
    expect(matchAcceptLanguage(LOCALES, 'de;q=NaN')).toBe('de')
    expect(matchAcceptLanguage(LOCALES, 'de;q=')).toBe('de')
  })

  it('is case-insensitive', () => {
    expect(matchAcceptLanguage(LOCALES, 'DE-de')).toBe('de')
  })
})

describe('splitLocalePath', () => {
  it('splits a leading locale segment', () => {
    expect(splitLocalePath(LOCALES, '/de/pricing')).toEqual({
      locale: 'de',
      pathname: '/pricing'
    })
  })

  it('leaves an unprefixed path alone', () => {
    expect(splitLocalePath(LOCALES, '/pricing')).toEqual({pathname: '/pricing'})
  })

  it('handles a bare locale root', () => {
    expect(splitLocalePath(LOCALES, '/de')).toEqual({locale: 'de', pathname: '/'})
  })

  it('only ever treats position 0 as a locale', () => {
    // `/docs/de` is a page, not German docs — a prefix sits at position 0 or nowhere.
    expect(splitLocalePath(LOCALES, '/docs/de')).toEqual({pathname: '/docs/de'})
    // `/de/de` is unambiguous: German locale, page `de`.
    expect(splitLocalePath(LOCALES, '/de/de')).toEqual({locale: 'de', pathname: '/de'})
  })

  it('ignores an unsupported segment that looks like a locale', () => {
    expect(splitLocalePath(LOCALES, '/es/pricing')).toEqual({pathname: '/es/pricing'})
  })
})

describe('negotiate — prefix mode: the URL is authoritative', () => {
  it('takes the locale from the path', () => {
    const r = negotiate(prefixMode, {pathname: '/de/pricing'})
    expect(r.locale).toBe('de')
    expect(r.localeWasExplicit).toBe(true)
  })

  it('treats an unprefixed path as the default locale', () => {
    // `as-needed` prefixing: the unprefixed URL IS the default-locale page, which is what
    // removes the need to redirect anything.
    const r = negotiate(prefixMode, {pathname: '/pricing'})
    expect(r.locale).toBe('en')
    expect(r.localeWasExplicit).toBe(false)
  })

  it('does NOT let a cookie override the URL', () => {
    // Serving German at the English URL would give one URL two contents and make its
    // canonical a lie. The cookie becomes a suggestion instead.
    const r = negotiate(prefixMode, {pathname: '/pricing', cookie: 'de'})
    expect(r.locale).toBe('en')
    expect(r.suggestedLocale).toBe('de')
  })

  it('does NOT let Accept-Language override the URL', () => {
    const r = negotiate(prefixMode, {
      pathname: '/pricing',
      acceptLanguage: 'de-DE,de;q=0.9'
    })
    expect(r.locale).toBe('en')
    expect(r.suggestedLocale).toBe('de')
  })

  it('offers no suggestion when the hint agrees with the URL', () => {
    const r = negotiate(prefixMode, {pathname: '/de/pricing', cookie: 'de'})
    expect(r.locale).toBe('de')
    expect(r.suggestedLocale).toBeUndefined()
  })

  it('prefers the cookie over Accept-Language when suggesting', () => {
    const r = negotiate(prefixMode, {
      pathname: '/pricing',
      cookie: 'fr',
      acceptLanguage: 'de'
    })
    expect(r.locale).toBe('en')
    expect(r.suggestedLocale).toBe('fr')
  })
})

describe('negotiate — cookie mode: the request decides', () => {
  it('prefers the cookie', () => {
    const r = negotiate(cookieMode, {
      pathname: '/',
      cookie: 'de',
      acceptLanguage: 'fr'
    })
    expect(r.locale).toBe('de')
    expect(r.localeWasExplicit).toBe(true)
  })

  it('falls back to Accept-Language', () => {
    const r = negotiate(cookieMode, {pathname: '/', acceptLanguage: 'fr-CA,fr;q=0.9'})
    expect(r.locale).toBe('fr')
    expect(r.localeWasExplicit).toBe(true)
  })

  it('falls back to the default and marks it implicit', () => {
    const r = negotiate(cookieMode, {pathname: '/'})
    expect(r.locale).toBe('en')
    // `localeWasExplicit: false` is what tells a layout NOT to persist a guess as a choice.
    expect(r.localeWasExplicit).toBe(false)
  })

  it('ignores an unsupported cookie value', () => {
    const r = negotiate(cookieMode, {pathname: '/', cookie: 'xx'})
    expect(r.locale).toBe('en')
  })

  it('never reads the path', () => {
    // Cookie mode is for authenticated UI, where the URL carries no locale.
    const r = negotiate(cookieMode, {pathname: '/de/pricing'})
    expect(r.locale).toBe('en')
  })
})

describe('negotiate — crawler safety', () => {
  it('resolves the default for a request with no cookie and no Accept-Language', () => {
    // The shape of a Googlebot/GPTBot request. It must resolve deterministically — and the
    // caller must not redirect, which is why `negotiate` returns a locale and nothing else:
    // there is no redirect for a caller to accidentally perform.
    for (const options of [cookieMode, prefixMode]) {
      const r = negotiate(options, {pathname: '/'})
      expect(r.locale).toBe('en')
      expect(r).not.toHaveProperty('redirect')
      expect(r).not.toHaveProperty('location')
    }
  })

  it('serves the prefixed URL a crawler followed, regardless of headers', () => {
    // Having reached /de/pricing from a sitemap or hreflang, a crawler sending an en-US
    // default header must still get German.
    const r = negotiate(prefixMode, {
      pathname: '/de/pricing',
      acceptLanguage: 'en-US,en;q=0.9'
    })
    expect(r.locale).toBe('de')
  })
})

describe('hasLocale', () => {
  it('narrows a supported candidate', () => {
    const candidate: string = 'de'
    expect(hasLocale(LOCALES, candidate)).toBe(true)
    if (hasLocale(LOCALES, candidate)) {
      const narrowed: 'en' | 'de' | 'fr' = candidate
      expect(narrowed).toBe('de')
    }
  })

  it('rejects anything else', () => {
    expect(hasLocale(LOCALES, 'es')).toBe(false)
    expect(hasLocale(LOCALES, undefined)).toBe(false)
    expect(hasLocale(LOCALES, '')).toBe(false)
  })
})

describe('basenameForLocale', () => {
  it('gives the default locale no basename under as-needed', () => {
    expect(basenameForLocale(prefixMode, 'en')).toBe('')
  })

  it('prefixes every other locale', () => {
    expect(basenameForLocale(prefixMode, 'de')).toBe('/de')
  })

  it('prefixes the default too under `always`', () => {
    const always: I18nOptions = {...prefixMode, prefix: 'always'}
    expect(basenameForLocale(always, 'en')).toBe('/en')
    expect(basenameForLocale(always, 'de')).toBe('/de')
  })

  it('never produces one in cookie mode', () => {
    // Every locale lives at the same URLs there.
    expect(basenameForLocale(cookieMode, 'de')).toBe('')
  })

  it('is what negotiate reports, so the client cannot re-derive it differently', () => {
    expect(negotiate(prefixMode, {pathname: '/de/pricing'}).basename).toBe('/de')
    expect(negotiate(prefixMode, {pathname: '/pricing'}).basename).toBe('')
  })
})

describe('canonicalRedirect — deterministic, never negotiated', () => {
  it('strips the default locale prefix under as-needed', () => {
    expect(canonicalRedirect(prefixMode, '/en/pricing')).toBe('/pricing')
    expect(canonicalRedirect(prefixMode, '/en')).toBe('/')
  })

  it('leaves an already-canonical URL alone', () => {
    // The common case: no redirect at all.
    expect(canonicalRedirect(prefixMode, '/pricing')).toBeUndefined()
    expect(canonicalRedirect(prefixMode, '/de/pricing')).toBeUndefined()
    expect(canonicalRedirect(prefixMode, '/')).toBeUndefined()
  })

  it('adds the default prefix under `always`', () => {
    const always: I18nOptions = {...prefixMode, prefix: 'always'}
    expect(canonicalRedirect(always, '/pricing')).toBe('/en/pricing')
    expect(canonicalRedirect(always, '/')).toBe('/en')
    expect(canonicalRedirect(always, '/de/pricing')).toBeUndefined()
  })

  it('does nothing in cookie mode', () => {
    expect(canonicalRedirect(cookieMode, '/en/pricing')).toBeUndefined()
  })

  it('does not depend on cookies or Accept-Language', () => {
    // The signature takes neither — a varying redirect is impossible to express, which is
    // the point: crawlers send neither signal, so varying on them funnels them all to one
    // locale. Deterministic redirects they simply follow.
    expect(canonicalRedirect.length).toBe(2)
  })

  it('never treats a non-leading locale segment as a prefix', () => {
    expect(canonicalRedirect(prefixMode, '/docs/en')).toBeUndefined()
  })
})

describe('localeUrls — canonical + hreflang cluster', () => {
  const ORIGIN = 'https://example.com'

  it('builds an absolute URL per locale from each basename', () => {
    const {byLocale} = localeUrls(prefixMode, ORIGIN, '/pricing')
    expect(byLocale).toEqual({
      en: 'https://example.com/pricing',
      de: 'https://example.com/de/pricing',
      fr: 'https://example.com/fr/pricing'
    })
  })

  it('keeps the site root a single slash, not an empty path', () => {
    const {byLocale} = localeUrls(prefixMode, ORIGIN, '/')
    expect(byLocale.en).toBe('https://example.com/')
    // …and does NOT turn /de into /de/, which is a different URL to a crawler and not the
    // one the trailing-slash middleware serves.
    expect(byLocale.de).toBe('https://example.com/de')
  })

  it('tolerates a trailing slash on the configured origin', () => {
    expect(localeUrls(prefixMode, 'https://example.com/', '/pricing').byLocale.en).toBe(
      'https://example.com/pricing'
    )
  })

  it('emits a self-referential, bidirectional cluster', () => {
    // Every version lists EVERY version including itself; a missing return link makes
    // Google discard the whole cluster.
    const {alternates} = localeUrls(prefixMode, ORIGIN, '/pricing')
    expect(alternates.map(a => a.hreflang)).toEqual(['en', 'de', 'fr', 'x-default'])
    // Identical whichever locale is being rendered — that IS bidirectionality.
    expect(localeUrls(prefixMode, ORIGIN, '/pricing').alternates).toEqual(alternates)
  })

  it('points x-default at the default locale', () => {
    const {alternates} = localeUrls(prefixMode, ORIGIN, '/pricing')
    const xDefault = alternates.find(a => a.hreflang === 'x-default')!
    expect(xDefault.href).toBe('https://example.com/pricing')
  })

  it('uses absolute URLs everywhere — relative ones are invalid in hreflang', () => {
    for (const a of localeUrls(prefixMode, ORIGIN, '/pricing').alternates) {
      expect(a.href).toMatch(/^https:\/\//)
    }
  })

  it('gives every locale the same URL in cookie mode', () => {
    // One URL serving several languages: there is nothing to distinguish, which is exactly
    // why cookie mode is authenticated-UI only.
    const {byLocale} = localeUrls(cookieMode, ORIGIN, '/pricing')
    expect(new Set(Object.values(byLocale)).size).toBe(1)
  })
})

describe('localizeSitemapUrl', () => {
  const ORIGIN = 'https://example.com'

  it('expands one declared URL into an entry per locale', () => {
    // A sitemap listing only /pricing tells crawlers the other locales do not exist.
    const entries = localizeSitemapUrl(prefixMode, ORIGIN, '/pricing')!
    expect(entries.map(e => e.loc)).toEqual([
      'https://example.com/pricing',
      'https://example.com/de/pricing',
      'https://example.com/fr/pricing'
    ])
  })

  it('repeats the full alternate cluster on every entry', () => {
    // The sitemap equivalent of the bidirectional <head> cluster.
    const entries = localizeSitemapUrl(prefixMode, ORIGIN, '/pricing')!
    for (const e of entries) {
      expect(e.alternates.map(a => a.hreflang)).toEqual(['en', 'de', 'fr', 'x-default'])
    }
    expect(entries[0].alternates).toEqual(entries[1].alternates)
  })

  it('leaves an already-prefixed URL alone — the per-URL opt-out', () => {
    // The app named an exact URL; expanding it would invent siblings it did not ask for.
    expect(localizeSitemapUrl(prefixMode, ORIGIN, '/de/about')).toBeUndefined()
  })

  it('accepts an absolute URL as well as a path', () => {
    const entries = localizeSitemapUrl(prefixMode, ORIGIN, 'https://example.com/pricing')!
    expect(entries[0].loc).toBe('https://example.com/pricing')
  })

  it('does not expand in cookie mode', () => {
    // Every locale shares one URL there, so there is nothing to expand into.
    expect(localizeSitemapUrl(cookieMode, ORIGIN, '/pricing')).toBeUndefined()
  })

  it('handles the site root', () => {
    const entries = localizeSitemapUrl(prefixMode, ORIGIN, '/')!
    expect(entries.map(e => e.loc)).toEqual([
      'https://example.com/',
      'https://example.com/de',
      'https://example.com/fr'
    ])
  })
})
