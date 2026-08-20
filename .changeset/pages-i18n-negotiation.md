---
'@getcronit/pylon': minor
---

SSR locale negotiation for usePages — P1 of rfcs/SSR_I18N.md.

```ts
usePages({i18n: {locales: ['en', 'de', 'fr'], defaultLocale: 'en', routing: 'cookie'}})
```

```tsx
const {locale, localeWasExplicit, suggestedLocale} = useLocale()
```

The negotiated locale reaches pages as `useLocale()` and travels in the hydration envelope
alongside `context`, so the client reads the SERVER's locale instead of deriving one from
`navigator.language` — hydration parity is structural rather than a discipline, and there is
no locale flash. Verified in a browser: with `navigator.language === 'en-US'` and a `locale=de`
cookie, the page renders German with no hydration warning.

**Negotiation never redirects.** The pattern Next.js documents — read `Accept-Language` in
middleware, redirect to the negotiated locale — sends every crawler to the default locale,
because Googlebot "sends HTTP requests without setting Accept-Language" and Bingbot, GPTBot,
ClaudeBot and PerplexityBot generally don't either. `negotiate()` returns a locale and nothing
else, so there is no redirect for a caller to perform, and the e2e pins the absence of one.

- `routing: 'cookie'` — cookie, then `Accept-Language`, then the default. For AUTHENTICATED
  app UI only: one URL serving several languages has no second URL to canonicalise.
- `routing: 'prefix'` — the URL is authoritative; a disagreeing cookie or `Accept-Language`
  becomes `suggestedLocale` (render a "Auf Deutsch ansehen" link) rather than changing what is
  served. Negotiation is implemented and unit-tested; locale ROUTING — mounting the route tree
  under a locale segment on server and client — lands in a later phase, and `prefix` becomes
  the default then.
- `hasLocale()` narrows `string` to a supported locale so an unrecognised segment can 404
  rather than silently falling back.
- `Accept-Language` parsing honours q-values and falls back from region to base language
  (`de-AT` → `de`). It never throws on malformed input, and is deliberately lenient about a
  malformed weight (`de;q=NaN` still means German) — the header is a hint, not a boundary.
- `Vary: Cookie, Accept-Language` is emitted whenever i18n is configured.

Opt-in: without `i18n`, nothing about locales runs. `useLocale()` throws when unconfigured
rather than inventing `'en'`, which would look like it worked and mistranslate everything.
