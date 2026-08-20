import {describe, expect, it} from 'vitest'
import {
  hasLocale,
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
