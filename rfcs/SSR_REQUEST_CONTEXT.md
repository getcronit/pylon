# RFC: SSR request context — cookies in, cookies out

Status: **Draft**. Scope: the request-scoped channel between the HTTP layer and a `usePages`
SSR render — reading request state (cookies, headers) during render, and writing response
state (`Set-Cookie`) back out. Prerequisite for [SSR i18n](./SSR_I18N.md).

## What already works (verified, not assumed)

`usePages` already has a request-scoped read channel, and it is complete end to end:

- The SSR handler reads `c.get('pagesContext')` from the Hono context
  ([setup/index.tsx:448](../packages/pylon/src/pages/plugins/use-pages/setup/index.tsx)).
- It reaches every page and layout as `PageProps.context`, and anywhere in the tree via
  `useRouteData().context`.
- `DataClientProvider` serialises it into `window.__pylonStaticData.context`, so the client
  hydrates with the **identical** value — no mismatch, no flash
  ([internals.tsx](../packages/pylon/src/pages/pages/internals.tsx)).

A ~15-line plugin that populates `pagesContext` from cookies was measured against a running
app:

| Request | Rendered |
| --- | --- |
| no cookies | `<html lang="en">` · `Hello` · `data-state="open"` |
| `theme=dark` | `<html lang="en" class="dark">` |
| `locale=de` | `<html lang="de">` · `Hallo` |
| `sidebar=closed` | `data-state="closed"` |
| `Accept-Language: de-DE` | `<html lang="de">` · `Hallo` |

Client received `{"context":{"theme":"dark","sidebarOpen":false,"locale":"de"}}`.

**So flash-free cookie theming and sidebar state need no framework change at all.** Writing
cookies from *middleware* also already works: the SSR HTML is fully buffered
(`await new Response(stream).text()`, then `c.html(html)`), so headers stay mutable after
`next()` — a first visit with `Accept-Language: de` correctly returned
`set-cookie: locale=de; Path=/; Max-Age=31536000; SameSite=Lax`.

This RFC is therefore **not** about building a channel. It is about making the existing one
discoverable, typed, and writable from inside a render.

## Motivation

Four concrete gaps:

1. **`pagesContext` is an undocumented internal.** Nothing in `docs/`, `e2e/`, or `examples/`
   sets it. It is read as `c.get('pagesContext' as any)` and typed as
   `Variables['pagesContext']` behind a `@ts-expect-error`
   ([types.ts:15](../packages/pylon/src/pages/plugins/use-pages/types.ts)). The single most
   useful seam in `usePages` reads like something you are not supposed to touch.
2. **No cookie helpers reachable from an app.** `import {getCookie} from 'hono/cookie'` does
   not resolve in a scaffolded project — `hono` is *pylon's* dependency, not the app's, and
   pylon re-exports nothing. This broke the first attempt at the probe above under pnpm's
   strict layout; npm's flat hoisting would mask it, which makes it worse, not better.
3. **No way to set a cookie from inside a page or layout.** Only middleware can. A component
   that wants to persist what it just computed has no seam.
4. **No `Vary`.** Nothing caches SSR HTML in-framework today, so this is latent rather than
   broken — but the first CDN in front of a cookie-varying app mis-caches it.

## The constraint that shapes the design

**AsyncLocalStorage does not survive React's async render.** This is the framework's own
finding, recorded where the per-request GraphQL fetcher is built:

> Per-request client with a request-bound fetcher: the in-process GraphQL call forwards this
> request's headers and hits the mounted app directly, avoiding AsyncLocalStorage (which
> React's async render breaks out of).

So a Next.js-style ambient `cookies()` / `headers()` API is **off the table**. Request state
must be *threaded* through the React tree, exactly as `pagesContext` and the query client
already are. Every design below follows that existing grain rather than fighting it.

## Goals

1. `pagesContext` becomes a **documented, typed, first-class** seam with a helper that gets
   the plugin strategy right.
2. Cookie read/write helpers are **importable from pylon**, no `hono` dependency in the app.
3. A page or layout can **set a cookie during SSR**, safely.
4. Apps can declare **`Vary`** so cookie-varying HTML is cacheable-correct.

## Non-goals

- Server actions / form mutations. Different RFC.
- Session management, CSRF, or an auth story — `useIdentity` owns that.
- Arbitrary response mutation from render (status codes, redirects). `redirect()`/`notFound()`
  already cover the throw-based cases.

## Design

### 1. `useRequestContext(factory, options?)` — a plugin helper

Exported from `@getcronit/pylon/pages/plugin`. Wraps the middleware registration so apps stop
hand-rolling it and can't get the strategy wrong:

```ts
// pylon.config.ts
import {usePages, useRequestContext} from '@getcronit/pylon/pages/plugin'
import {useNodeServer, type PylonConfig} from '@getcronit/pylon'

export default {
  plugins: [
    useRequestContext(
      c => ({
        theme: getCookie(c, 'theme') ?? 'system',
        sidebarOpen: getCookie(c, 'sidebar') !== 'closed'
      }),
      {vary: ['Cookie']}
    ),
    usePages(),
    useNodeServer()
  ]
} satisfies PylonConfig
```

Default `'first'` strategy, so it lands before the `usePages` catch-all (`'last'`) — the
ordering the current manual approach silently depends on. The factory may be async.

Typing stays declaration-merged, which already works and needs only documenting:

```ts
// pylon.d.ts
declare module '@getcronit/pylon' {
  interface Variables {
    pagesContext: {theme: string; sidebarOpen: boolean}
  }
}
```

Change `PageProps.context` from the `@ts-expect-error` cast to a conditional that resolves to
`unknown` when `Variables` has no `pagesContext` — an app that never declares it gets
`unknown` (honest) instead of a suppressed error.

### 2. Re-export cookie helpers

`getCookie`, `setCookie`, `deleteCookie` re-exported from `@getcronit/pylon` (they are
`hono/cookie`, already in the runtime graph). Closes gap 2 with a one-line change and no new
dependency.

### 3. Response-header collector — cookies out of a render

The enabling fact: **the render is fully buffered before the response is built.** So the
handler can hand the render a collector, let the tree write into it, and apply the result
before `c.html(html)`.

```
app.get('*')
  ├─ create pagesClient        (exists)
  ├─ create responseCookies    (NEW — a Map<name, SetCookieSpec>)
  ├─ render → buffered string  (exists; tree writes into the Map)
  ├─ apply responseCookies → c (NEW)
  └─ c.html(html)              (exists)
```

Threaded through `DataClientProvider` alongside `pagesContext` — the same channel, no new
plumbing — and surfaced as a server-only hook:

```tsx
import {useResponseCookies} from '@getcronit/pylon/pages'

export default function RootLayout({children, context}: LayoutProps) {
  const cookies = useResponseCookies()
  if (!context.localeWasExplicit) {
    cookies.set('locale', context.locale, {maxAge: 31536000, sameSite: 'Lax', path: '/'})
  }
  return <html lang={context.locale}>{children}</html>
}
```

Three deliberate constraints:

- **A `Map` keyed by cookie name, not a list.** The error path renders **twice**
  (`renderToHtml` is called again inside the `catch` to populate the error boundary), so an
  append-based collector would emit duplicate `Set-Cookie` headers. Last-write-wins per name
  is naturally idempotent across both renders.
- **Idempotent writes only**, and the docs must say so plainly. This is a side effect during
  render; it is safe for "set this cookie to this computed value" and unsafe for counters or
  appends. React may render a component more than once.
- **Client-side is a no-op** that warns in dev. The hook exists on both sides so components
  don't need `typeof window` guards, but only the server render produces headers.

### 4. `Vary`

`useRequestContext(factory, {vary: ['Cookie']})` appends to the SSR response's `Vary`. Not
inferred — we cannot see which headers the factory read — so it is explicit and additive. The
`usePages` catch-all currently sets no `Vary` at all; static asset routes keep their existing
`Cache-Control` handling untouched.

## Staged plan

**P0 — make the existing seam usable.** No render changes, no risk.
- Re-export `getCookie`/`setCookie`/`deleteCookie` from `@getcronit/pylon`.
- Add `useRequestContext()` plugin helper (+ `vary`).
- Fix `PageProps.context` typing; drop the `@ts-expect-error`.
- Document the whole read path, including that it hydrates for free.
- e2e: cookie-driven SSR across variants + hydration-envelope parity (the probe above,
  promoted to a fixture).

**P1 — cookies out.**
- `responseCookies` collector, threaded via `DataClientProvider`, applied before `c.html`.
- `useResponseCookies()` exported; client no-op.
- e2e: set-from-layout produces exactly one `Set-Cookie`; **explicitly assert the error path
  does not duplicate it** (force a component throw); assert a client-side call is inert.

**P2 — scaffold integration (optional).** Wire theme + sidebar cookies into the `create-pylon`
pages template so the starter demonstrates flash-free SSR state. Depends on the template work
already landed.

## Risks and open questions

- **Side effects during render.** Mitigated by the keyed Map and a narrow documented contract,
  but it remains a sharp edge. Alternative considered and rejected: a `headers()` export from
  the page module (Next-style), which is static and cannot depend on rendered data — it would
  not serve the "persist what I just computed" case that motivates this.
- **Streaming.** If SSR ever moves to true streaming (shipping bytes before the render
  completes), header-after-render becomes impossible and this API breaks. That is a real
  future direction and the RFC should be revisited if it is taken. Today's full buffering is
  what makes P1 cheap.
- **`Vary: Cookie` is a blunt cache key.** Any cookie change busts the entry. A future
  refinement could key on a derived value instead, but that needs a caching layer to exist
  first.
- Open: should `useRequestContext` factories be able to *fail* a request (throw a `Response`)?
  Cheap to allow, but it overlaps `redirect()` semantics.
