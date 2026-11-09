---
'@getcronit/pylon': minor
---

Locale-aware sitemap, and a warning for routes shadowed by a locale.

**Sitemap.** Each declared URL now expands into one entry per locale, every entry repeating
the full `xhtml:link` alternate cluster — the sitemap equivalent of the `<head>` hreflang
cluster. Declaring `/pricing` once yields `/pricing`, `/de/pricing` and `/fr/pricing`;
previously a localized site advertised only its default language, leaving the other locales
discoverable solely by being linked from somewhere.

A URL that already carries a locale prefix is emitted verbatim — the app named an exact URL,
so expanding it would invent siblings it did not ask for, and that doubles as the per-URL
opt-out. Per-item `lastmod`, `changefreq` and `priority` are carried onto every expanded
entry. The configured `origin` is preferred over the request host, so a sitemap never
advertises `localhost` — or, behind a proxy, whatever host an attacker supplied.

**Shadowing warning.** A top-level route whose segment is a configured locale is unreachable
under `as-needed` prefixing: `/de` serves the German home page, and `/en/de` 301s back to it,
so a `pages/de/` route has no URL at all. Boot now warns, naming the route and both fixes
(rename it, or `prefix: 'always'`, where `/en/de` does reach the page).

Scoped precisely to the case that breaks: only single top-level segments, only in `as-needed`
mode. `/de/de` is unambiguous — locale, then page — and `/docs/de` never collided, because a
prefix only ever occupies position 0. A warning rather than an error, since the app may never
link the route.
