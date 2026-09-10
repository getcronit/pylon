---
'@getcronit/pylon': minor
---

Prefix locale routing for usePages — `/pricing` is English, `/de/pricing` German, from ONE
`pages/` tree.

```ts
usePages({i18n: {locales: ['en', 'de', 'fr'], defaultLocale: 'en'}})  // routing defaults to 'prefix'
```

There is no `[locale]` folder. Prefix routing is React Router's `basename`, not a duplicated
route table: `createStaticHandler(routes, {basename})` per locale on the server, and the same
basename on the client — read from the hydration envelope rather than re-derived, so the two
cannot disagree about where routes are mounted. A plain `<Link href="/pricing">` under `/de`
resolves to `/de/pricing` on its own.

`prefix: 'as-needed'` (default) serves the default locale unprefixed; `'always'` prefixes
every locale. Each owes one deterministic redirect so only one URL per locale is canonical —
`/en/pricing` 301s to `/pricing`, and the mirror under `'always'`. Deterministic is the
operative word: `canonicalRedirect()` takes only a path and the config, so a varying redirect
is not expressible. That matters because crawlers send neither cookies nor `Accept-Language`,
and a redirect that varies on them funnels every crawler into the default locale.

`routing` now defaults to `'prefix'` (it was `'cookie'` while routing was unimplemented).
`'cookie'` remains for authenticated app UI, where one URL serving several languages is fine
because nothing crawls or canonicalises it.

Fixes a hydration failure this exposed: the client pre-resolves lazy route modules with
`matchRoutes(routes, location)` before creating the router, and that call needs the basename
too. Without it `/de/pricing` strips to nothing, matches no route, the modules stay lazy, and
the router renders `HydrateFallback` over the server's markup — surfacing only as a generic
"Hydration failed" naming a `<div>` that appears nowhere in the served HTML.
