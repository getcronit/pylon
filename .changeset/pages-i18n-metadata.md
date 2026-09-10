---
'@getcronit/pylon': minor
---

Automatic `<link rel="canonical">` and `hreflang` alternates for localized pages.

```ts
usePages({
  origin: 'https://example.com',
  i18n: {locales: ['en', 'de', 'fr'], defaultLocale: 'en'}
})
```

Every localized page now emits its own canonical plus the full alternate cluster:

```html
<link rel="canonical" href="https://example.com/de/pricing" />
<link rel="alternate" hreflang="en" href="https://example.com/pricing" />
<link rel="alternate" hreflang="de" href="https://example.com/de/pricing" />
<link rel="alternate" hreflang="fr" href="https://example.com/fr/pricing" />
<link rel="alternate" hreflang="x-default" href="https://example.com/pricing" />
```

The cluster is byte-identical on every locale, which is what makes it bidirectional and
self-referential — a missing return link makes search engines discard the whole thing. Each
locale is its OWN canonical; cross-canonicalising locale variants is the classic way to make
Google drop every version but one. Live-site surveys put the hreflang error rate near 75%
with one bad entry voiding the cluster, which is the case for generating this rather than
documenting it — Next's i18n guide never mentions either tag.

- `origin` is required and is configuration, not derived from the request: both tags need
  absolute URLs, and behind a proxy the Host header is attacker-influenced — a canonical
  built from a spoofed host points search engines at another domain. Configuring `i18n`
  without `origin` warns once at boot, since silently emitting nothing is the exact failure
  this prevents.
- Alternates are computed per locale rather than assumed to be one path under different
  prefixes, so translated slugs (`/de/kontakt`) can be added later without reworking it.
- Error responses emit neither tag — a 404 must not advertise itself as a canonical page
  with translations.

The tags ride the existing SSR provider and React 19 hoists them into `<head>`, so apps need
no component and no config beyond `origin`.
