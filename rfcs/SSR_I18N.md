# RFC: SSR i18n for usePages

Status: **Draft**. Scope: locale negotiation, URL strategy, message catalogs, typed
translation, and locale-aware routing for `usePages` SSR + hydration. Builds on
[SSR request context](./SSR_REQUEST_CONTEXT.md), which owns the cookie read/write channel.

## Starting point

There is **no i18n in pylon today** — a search across `packages/pylon/src` for `i18n`,
`Accept-Language`, `useTranslation`, or locale negotiation returns nothing.

But the hard parts are already built, which is why this is a feature and not an architecture
change:

- **Request-scoped state reaches the render and hydrates identically.** `pagesContext` →
  `PageProps.context` → `window.__pylonStaticData.context`. A probe confirmed
  `Accept-Language: de-DE` and `locale=de` each render `<html lang="de">` with German copy,
  and the client receives the same context object.
- **The hydration envelope is an established pattern.** `window.__pylonStaticData` already
  carries `{cache, context}`; a message catalog is a third key in the same envelope.
- **Routes are file-based with dynamic segments** (`[param]`, `[...catchAll]`) and each route
  is **lazily imported**, so per-route code splitting already exists.
- **Pylon owns `<Link>`** ([pages/link.tsx](../packages/pylon/src/pages/pages/link.tsx)), which
  is what makes locale-preserving navigation something the framework can do rather than
  something every app hand-rolls.
- **Translations-as-data already works.** A `useData` query returning strings is SSR-rendered
  and hydration-cached for free, today.

## Motivation: what this looks like without a framework story

`viennahotels.at` is a production Pylon 3 + usePages app using i18next. Every failure mode
below is live in it today:

- **SSR translation is deliberately switched off.** `I18nProvider` renders children *without*
  the provider until `useEffect` fires — comment: `// Prevent hydration issues`. The server
  emits untranslated markup; the client swaps it.
- **Detection is commented out** (`// .use(LanguageDetector)`).
- **The switcher forces English on every mount** and deliberately does not persist. A user's
  choice dies on reload.
- **Both catalogs are statically imported**, so every client downloads every locale.
- **No locale URLs at all.** German content is unreachable, unshareable, and unindexed.

### Why not "just use i18next"

`i18n/i18n.ts` initialises the **module-global** i18next singleton and `changeLanguage`
mutates it. Under SSR with concurrent requests that is shared mutable state — request A's
language can bleed into request B's render. i18next offers `createInstance()` for exactly
this, but the ergonomic default is unsafe on a server.

That is the real reason the mount-gate exists: not a hydration quirk, but the only way to make
a global singleton safe. **No library choice fixes it** — it needs a per-request locale
channel, which is what `pagesContext` is and what P1 formalises.

## The URL invariant

The rule is not "use a path prefix". It is:

> **One distinct, canonical, hreflang-annotated URL per locale.**

Verified against Google's guidance and against Google's own implementation:

- Googlebot **"sends HTTP requests without setting `Accept-Language`"** and sends no cookies.
  A cookie- or header-only site is, to a crawler, a single-language site.
- Google rates the four URL encodings: ccTLD ("clear geotargeting", expensive), subdomain
  ("easy to set up"), **subdirectory `example.com/de/` ("easy to set up, low maintenance")**,
  and **URL parameters `?loc=de` — "Not recommended"** ("URL-based segmentation difficult").
- Google's *own* docs nonetheless use `?hl=de` — and satisfy the invariant while doing it:
  each variant carries a **self-referencing canonical** (`…?hl=de`, `…?hl=ja`) and the page
  ships **19 hreflang alternates plus `x-default`** (measured directly). It is a retrofit onto
  a huge pre-existing URL space, not a model to copy.

So all four encodings are legal; **cookie-only is the only option that fails the invariant**,
because there is no second URL to canonicalise or annotate.

### Negotiation must never drive a redirect

This is the subtlest and most damaging trap, and **Next.js documents it as the recommended
pattern**: middleware reads `Accept-Language`, then `NextResponse.redirect`s an unprefixed URL
to the negotiated locale.

Independent crawler measurement ([merj](https://merj.com/blog/your-accept-language-redirects-could-be-blocking-search-engines-and-ai-crawlers))
found that Googlebot, Bingbot, **GPTBot, ClaudeBot and PerplexityBot** generally send no
`Accept-Language` at all; when an AI crawler does send one it is a hardcoded
`en-US,en;q=0.9` default, not user intent. (Applebot is an exception, matching ccTLDs.)
Consequences: every crawler lands on the default locale, non-English content is only partially
discovered by both search *and* LLM systems, and the bug is miserable to debug because the
header is inconsistently present.

Therefore:

- **`Accept-Language` may seed a cookie or raise a "View in Deutsch" suggestion. It must never
  change which URL is served.**
- The bare URL either serves real `x-default` content or redirects **deterministically** to
  `defaultLocale`. Predictable redirects are fine; *varying* ones are the problem.
- **Bot-detection to skip the redirect is not the fix** — that is serving different content to
  crawlers than to users, which is cloaking. The fix is not to vary.
- **Pylon should ship no redirect-on-`Accept-Language` helper at all.** Making the harmful
  pattern absent is more valuable than documenting a warning next to it.

### The feature this implies

For every URL-encoded mode, pylon emits automatically: the self-referencing canonical, the
full hreflang alternate set, `x-default`, `<html lang>`, and per-locale sitemap entries via the
existing `MetadataRoute.Sitemap`.

**This is the differentiator.** Nobody hand-writes 19 correct hreflang tags, and Next's i18n
guide never mentions hreflang or canonicals once — it covers routing and dictionaries and
leaves the entire discoverability layer to the reader. Pylon owns the layout and knows
`locales` plus the current path, so it is mechanical.

### Are the whole URLs translated?

Only the prefix is structural. Whether the REST of the path is translated —
`/de/kontakt` vs `/de/contact` — is a separate decision, and both are legitimate:

- **Untranslated slugs** (`/de/contact`) are what most framework-shaped sites ship, including
  Next's own guide. One path space, trivial to maintain, and alternates are the same path
  under different prefixes.
- **Translated slugs** (`/de/kontakt`) read better and match localized search queries. Google
  supports non-ASCII words in URLs given UTF-8 encoding. The cost is maintenance: every slug
  becomes a translated, versioned artifact, and changing one later needs a 301.

Rule of thumb from what real sites do: translate slugs that are **content** and user-facing
(articles, products, categories, marketing pages), leave **structural** paths alone
(`/api/...`, `/checkout`, admin). Never translate the locale segment itself — `de` is a code,
not a word.

**Pylon supports only untranslated slugs today.** `basename` prefixes; the path after it comes
from the `pages/` tree, so `/de/kontakt` would 404. Adding it means a pathname mapping
consulted in both directions — incoming (`/de/kontakt` → the `contact` route) and outgoing
(`<Link href="/contact">` on `/de` → `/de/kontakt`). The colocated, compiler-friendly shape
would be a static export on the page module (`export const pathnames = {de: 'kontakt'}`),
which the build can read the same way it reads `useData` selectors. Deliberately deferred —
but it must be designed before the metadata work hardens, because of the constraint below.

### What this forces on hreflang

**Alternates cannot be assumed to be the same path under a different prefix.** They must be
computed per locale, so translated slugs remain addable without reworking the emitter.

Three more constraints, all from the spec rather than taste:

- **Absolute URLs.** `hreflang` takes full URLs, not paths — so the framework needs the site
  origin. It cannot be inferred reliably from a request behind a proxy, so it must be
  configuration.
- **Bidirectional and self-referential.** Every version links to every version including
  itself. A missing return link invalidates the cluster.
- **Locale variants must NOT canonicalise to each other.** Each locale's page is its own
  canonical. A cross-locale canonical is the classic way to make Google drop every version
  but one.

Worth stating plainly why this belongs in the framework at all: surveys of live sites put the
**hreflang error rate around 75%** — missing return tags, wrong codes, relative URLs — and a
single bad entry makes Google ignore the whole cluster. This is exactly the sort of
mechanical, spec-bound, easy-to-get-wrong artifact a framework should generate rather than
document.

## Catalogs are TypeScript — which removes a whole build stage

The default-locale catalog is a `.ts` module with `as const`, not JSON:

```ts
// messages/en.ts
export default {
  nav: {home: 'Home'},
  checkout: {total: 'Total: {amount} for {count} items'}
} as const
```

Because message strings keep their **literal** types, both the key space and each message's
placeholders are recoverable by inference — dotted keys via a recursive mapped type,
placeholders by destructuring the literal string
(`S extends \`${string}{${infer V}}${infer Rest}\``). Verified under `tsc --strict`:

```ts
t('nav.home')                                     // ✓ takes no vars
t('checkout.total', {amount: '12.00', count: 3})  // ✓ both required
t('checkout.totl', {…})                           // ✗ typo'd key
t('checkout.total', {amount: '12.00'})            // ✗ missing `count`
t('nav.home', {amount: '1'})                      // ✗ vars where none exist
```

**JSON cannot do this.** Also verified: `resolveJsonModule` widens values to `string`, so
`typeof en.checkout.total` accepts arbitrary text. Placeholder typing from JSON needs codegen —
the only reason an earlier draft of this RFC proposed any.

**Translations may still be JSON.** Only the default locale is the type source; others need to
match its *shape*, and a widened `string` leaf satisfies that. So a JSON translation still gets
missing-key checking with no codegen (verified):

```ts
import de from './de.json'
const _de = de satisfies SameShape<typeof en>   // missing `checkout` → compile error
```

TMS round-trips stay viable: hand translators JSON, keep `en.ts` as the contract.

Consequence: **no `Messages` codegen, no generated `.pylon/i18n/`, no build hook for typing.**
The pages plugin's `build` hook is needed only for per-locale chunk splitting.

## Goals

1. **The URL is authoritative** for every URL-encoded mode; cookie and `Accept-Language`
   suggest, never redirect. Result on `pagesContext`.
2. **Discoverability by construction** — canonical, hreflang, `x-default`, sitemap emitted for
   every URL-encoded mode.
3. **Typed by construction** — keys and placeholders inferred; other locales shape-checked.
4. **Hydration parity by construction** — locale and catalog ride the existing envelope.
5. **No bloat** — only the active locale is inlined.
6. **`Intl` for formatting** — no runtime dependency.

## Non-goals

- Translation *management* — extraction, TMS sync, machine translation.
- **A JSON-only default catalog** — supporting one means shipping the codegen this RFC avoids.
- **Redirect-on-`Accept-Language`**, per above. Deliberately absent.
- RTL/bidi layout; collation beyond `Intl`.
- A new message syntax. `{placeholder}` + `Intl.PluralRules`, with an ICU seam later.

## Design

### Configuration

```ts
usePages({
  i18n: {
    locales: ['en', 'de', 'fr'],
    defaultLocale: 'en',
    routing: 'prefix',        // 'prefix' | 'query' | 'domain' | 'cookie'
    prefix: 'as-needed',      // 'as-needed' (default) | 'always'
    cookie: 'locale',
    catalogs: './messages'    // en.ts (type source) + de.ts | de.json, …
  }
})
```

`routing` modes:

| Mode | URL | Use when |
| --- | --- | --- |
| `prefix` *(default)* | `/pricing` · `/de/pricing` | public content — Google's recommended form, best cache key |
| `query` | `/pricing?hl=de` | retrofit only — see below; not on the critical path |
| `domain` | `example.de/pricing` | per-market sites (deferred — needs per-host config) |
| `cookie` | `/pricing` | **authenticated app UI only** |

`cookie` is not a peer option. It emits no hreflang or canonical (there is nothing to point
at), and **`pylon build` warns when it is combined with a sitemap** — turning the trap into a
diagnostic.

#### `query` is a retrofit, not a stepping stone

An earlier revision sequenced `query` first, on the grounds that it needs no route-tree work
and would deliver indexable multi-locale URLs a phase early. That was a bad trade: **URL shape
is the one decision that cannot be cheaply undone.** An app that ships `?hl=de` and later moves
to `/de/` pays for a full URL migration — 301s on every page, re-crawling, and a period of
degraded ranking — to save the framework one phase of work. Worse, `query` is the encoding
Google explicitly rates "Not recommended", so it would be the first mode that works and the
one nobody should end up on.

It stays supported for the case it is genuinely good at — retrofitting a URL space you cannot
restructure, which is exactly why Google's own docs use it — but it is not the path new apps
are led down, and it lands after `prefix`.

#### `prefix: 'as-needed'` is the default, and it is the safest option

The default locale is served unprefixed (`/pricing` = English, `/de/pricing` = German).
`'always'` prefixes every locale (`/en/pricing`).

This is not an aesthetic preference. **`as-needed` removes the redirect trap by
construction**: under `'always'` there is a locale-less `/pricing` that must redirect
somewhere, and choosing that destination is exactly the decision the crawler data says cannot
be made from `Accept-Language`. Under `as-needed` the unprefixed URL *is* the default-locale
page — real, canonical, indexable content. There is no bare URL left to negotiate at, so the
failure mode does not exist rather than being mitigated.

What each mode still owes:

- `as-needed`: `/en/pricing` **301s to `/pricing`**, so hand-written or legacy prefixed links
  resolve and only one URL is canonical.
- `always`: `/pricing` **301s to `/en/pricing`** — deterministic, never negotiated.

**The `pages/` tree is untouched.** There is no `[locale]` folder. Next requires physically
nesting every route under `app/[lang]`, which is a restructure that is expensive to reverse.

Mechanically this is React Router's `basename`, not route-table surgery — both routers already
accept one:

- server — `createStaticHandler(routes, {basename: '/de'})`, one handler per locale built at
  setup, since `locales` is known from config;
- client — `createBrowserRouter(routes, {basename})`, where the basename comes from the
  locale already in the hydration envelope (P1 put it there).

`<Link to="/pricing">` under basename `/de` emits `/de/pricing` on its own, so
locale-preserving navigation is a consequence rather than a feature to build. The default
locale simply gets no basename.

**Build-time shadowing check — narrower than it first appears.** Only the *single-segment*
case is ambiguous. Given locale `de` and a top-level route `pages/de/`:

| URL | Reading | Status |
| --- | --- | --- |
| `/de/de` | locale `de`, page `de` | unambiguous — locale is position 0, page is position 1 |
| `/docs/de` | default locale, page `docs/de` | unambiguous — a prefix only ever sits at position 0 |
| `/de` | German home **or** English page `de` | **ambiguous** |

The locale must win at position 0, or an entire locale becomes unreachable. So the page
loses — and under `as-needed` it has no other URL, because `/en/de` 301s to `/de`, which
resolves as German home. The route is genuinely unreachable.

Under `prefix: 'always'` there is no collision at all: `/en/de` is the English page, `/de/de`
the German one, `/de` the German home.

So the diagnostic is scoped to exactly that: a **top-level** route segment that is a
configured locale, in `as-needed` mode. `pylon build` warns, names the shadowed URL, and
offers the two real fixes — rename the route, or switch to `prefix: 'always'`. A warning
rather than an error: the app may legitimately not care about a route it never links to.

### Negotiation

**In a URL-encoded mode, the URL wins — full stop.** There is no precedence chain to reason
about: the locale is whatever the path (or query) says, and an absent prefix means
`defaultLocale`.

This matters most in the case that looks like it should be an exception. A returning visitor
whose cookie says `de` follows a search result to `/pricing`. They get **English**, because
serving German at the English URL is precisely the locale-adaptive pattern rejected above —
the same URL would then have two contents, and the canonical would be a lie. Cookie and
`Accept-Language` demote to *suggestion*: surface "Auf Deutsch ansehen" linking to
`/de/pricing`, and let the visitor choose. One click, one honest URL.

Cookie is authoritative only in `routing: 'cookie'` mode, which is authenticated-app-only and
has no crawler or canonical to be honest to.

Resolved once per request, before render, onto `pagesContext` as
`{locale, locales, defaultLocale, localeWasExplicit}`. `localeWasExplicit` distinguishes an
explicit prefix from an implicit default, which tells the layout whether to persist the cookie
— the case [SSR_REQUEST_CONTEXT](./SSR_REQUEST_CONTEXT.md) P1 exists to serve.

Steal from Next: a `hasLocale()` narrowing `string → Locale` that `notFound()`s on an
unrecognised segment, so a bad locale is a 404 rather than a silent fallback.

### The envelope

```
window.__pylonStaticData = {cache: …, context: …, i18n: {locale: 'de', messages: {…}}}
```

Only the active locale is inlined; switching lazily fetches the target chunk. Because the
catalog arrives in the same envelope as `context`, the client cannot render a different locale
than the server did — parity is structural, not a discipline.

### API

```tsx
import {useTranslations, useLocale, useFormatter} from '@getcronit/pylon/pages'

function Total({cents, count}: {cents: number; count: number}) {
  const t = useTranslations('checkout')   // namespace = key prefix
  const {number} = useFormatter()
  return <p>{t('total', {count, amount: number(cents / 100, {style: 'currency', currency: 'EUR'})})}</p>
}
```

`useLocale()` reads `pagesContext`, so it works unchanged on server *and* client — unlike
Next's `next/root-params`, which is explicitly unavailable in Client Components. Typing is
wired by declaration merging, sourced from the app's own catalog rather than a generated file:

```ts
declare module '@getcronit/pylon/pages' {
  interface Register {
    messages: (typeof import('./messages/en'))['default']
  }
}
```

A REGISTRY, not `interface Catalog extends …`. That form is illegal — TS2499, "An interface
can only extend an identifier/qualified-name" — and because an app's `pylon.d.ts` is a
declaration file, `skipLibCheck: true` (which pylon's own scaffold sets) suppresses the
error entirely: the augmentation silently does nothing and every key resolves to `never`
with no explanation. A property type may be any type expression, so the registry has no such
restriction.

`<Link>` preserves the locale automatically — the param-threading Google's docs do by hand on
every link.

## Staged plan

**P1 — negotiation only.** *(landed)* `i18n` config, negotiation (no redirects), `hasLocale`,
`useLocale()`, `Vary`, locale on `pagesContext` and in the hydration envelope. `cookie` routing
works end to end; prefix negotiation is implemented and unit-tested but not yet routed.

**P2 — `prefix` routing + discoverability.** The load-bearing phase, and deliberately ahead of
catalogs: URL shape is what an app cannot change later without a migration, so it should be
right before anyone builds on it. Catalogs are additive and cost nothing to add afterwards.

- per-locale `createStaticHandler(routes, {basename})` on the server, `createBrowserRouter`
  basename from the envelope on the client;
- `prefix: 'as-needed'` (default) with `/en/*` → `/*` 301s, and `'always'` with the mirror;
- deterministic `/` handling — never negotiated;
- `<Link locale="de">` for switching (plain `<Link>` already preserves the locale via
  basename);
- **canonical, hreflang, `x-default` and per-locale `MetadataRoute.Sitemap` entries**, emitted
  automatically — the differentiator, and the thing Next leaves entirely to the reader;
- the top-level route/locale shadowing warning.

*Test:* `/de/pricing` renders German and `/pricing` English, from ONE `pages/` tree; `/en/*`
301s; hreflang is complete, self-referencing and includes `x-default`; a crawler request with
no `Accept-Language` is never redirected; client-side navigation stays within the locale.

**P3 — catalogs, `useTranslations`, and typing.** Catalog convention, envelope key,
interpolation, `useFormatter`, the `Catalog` declaration-merge seam, `SameShape` for
translations. Only the active locale inlined. **Typing needs no build work** — it is the
`as const` inference above, so this phase is smaller than it looks.

*Test:* a German request contains German copy and only the German catalog; no hydration
warning; a missing key falls back to the default locale then to the key; type-level
`@ts-expect-error` tests for typo'd keys, missing/spurious placeholders, and an incomplete
translation in both `.ts` and `.json` form.

**P4 — ICU seam + plurals.** `Intl.PluralRules` in core; `intl-messageformat` as an opt-in
adapter for select/ordinal.

**Later, if wanted — `query` routing.** The retrofit encoding, for an app whose URL space
cannot be restructured. Reuses P2's metadata emission wholesale.

## Risks and open questions

- **No RSC.** Next's dictionaries stay server-side, so a mostly-static marketing site ships
  less JS than pylon will — pylon hydrates every page component, so the active catalog *must*
  travel. State it plainly. The mitigation is that Next's advantage evaporates as soon as a
  string is needed in an interactive component, at which point Next users adopt a provider
  library that serialises messages clientward anyway.
- **Type-level cost.** Recursive mapped types over a 2000-key catalog may measurably slow
  `tsc`. Benchmark in P2; fallback is namespace-scoped key unions, which
  `useTranslations('checkout')` already makes natural.
- **Catalog size in HTML.** Namespace-level splitting (only the namespaces a route uses) is the
  answer for large apps; the `useData` static analyzer is precedent that the analysis is
  feasible. Deliberately out of P2.
- **Error-path double render.** `renderToHtml` runs twice on the error path; anything i18n adds
  to the envelope must stay render-independent. Negotiation happens before render, so it is.
- **`Vary: Cookie`** makes SSR HTML near-uncacheable at a shared CDN — one more reason `cookie`
  mode is authenticated-only, and `prefix`/`query` are the public answer.
- Open: `Intl` availability on workerd/Deno for the full locale set — check before P2, since
  `usePages` is not Node-only.

## Sources

- [Managing multi-regional and multilingual sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites) — URL structure options
- [How Google crawls locale-adaptive pages](https://developers.google.com/search/docs/specialty/international/locale-adaptive-pages) — no `Accept-Language` from Googlebot
- [Localized versions of your pages](https://developers.google.com/search/docs/specialty/international/localized-versions) — hreflang
- [Your Accept-Language redirects could be blocking search engines and AI crawlers](https://merj.com/blog/your-accept-language-redirects-could-be-blocking-search-engines-and-ai-crawlers) — crawler header measurement
- [Next.js: Internationalization](https://nextjs.org/docs/app/guides/internationalization) — the DIY baseline, and the redirect pattern this RFC rejects
