---
'@getcronit/pylon': minor
---

Make the usePages SSR request-context channel a documented, typed, first-class seam, and
re-export Hono's cookie helpers.

`pagesContext` already carried request state into an SSR render and hydrated it identically
(the catch-all reads `c.get('pagesContext')` and serialises it into
`window.__pylonStaticData.context`), which is what makes cookie-driven theme, sidebar or
locale state flash-free. But nothing documented it, nothing set it in any fixture or example,
it was read as `c.get('pagesContext' as any)`, and `PageProps.context` was
`Variables['pagesContext']` behind a `@ts-expect-error` — which silently resolved to `any`.

- `useRequestContext(factory, {vary})`, exported from `@getcronit/pylon/pages/plugin`,
  populates it. It is a `'first'`-strategy plugin, so it beats the `usePages` catch-all
  (`'last'`) regardless of its position in the `plugins` array — the ordering footgun a
  hand-rolled middleware silently depends on.
- `vary` appends to the response `Vary` additively, without duplicating existing entries.
- `PageProps.context` is now `PagesContext`, which resolves to the app's declared
  `Variables['pagesContext']` or to `unknown` when undeclared. Apps that relied on the
  suppressed `any` must declare the shape (or narrow at the use site).
- `getCookie`, `getSignedCookie`, `setCookie`, `setSignedCookie` and `deleteCookie` are
  re-exported from `@getcronit/pylon`. An app cannot `import {getCookie} from 'hono/cookie'`
  itself: `hono` is pylon's dependency, so under pnpm's strict layout the specifier does not
  resolve — and under npm's flat hoisting it resolves by accident, which is worse.

Setting cookies from inside a render (P1 of rfcs/SSR_REQUEST_CONTEXT.md) is not included here;
middleware can already do it, since the SSR HTML is fully buffered before the response is
built.
