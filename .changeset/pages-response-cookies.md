---
'@getcronit/pylon': minor
---

`useResponseCookies()` — set cookies on the SSR response from inside a page or layout.

Previously only middleware could set a cookie on a rendered page, so a component had no way to
persist something it had just computed (a negotiated locale, a first-visit marker).

```tsx
const cookies = useResponseCookies()
if (!context.seen) cookies.set('seen', '1', {path: '/', maxAge: 31536000, sameSite: 'Lax'})
```

This is possible only because the SSR render is fully BUFFERED — `usePages` collects the
stream to a string and builds the response afterwards — so the tree can write into a
per-request collector that the handler flushes before any response is built, including the
component-thrown redirect and critical-error paths. An ambient Next-style `cookies()` is not
available: React's async render breaks out of AsyncLocalStorage, so the collector rides the
existing provider alongside `pagesContext`.

Writes are keyed by cookie NAME rather than appended. The SSR error path renders the tree
twice (once to discover the throw, once with the error context populated), so an append-style
collector emits duplicate `Set-Cookie` headers for that request — verified by mutating the
implementation, which makes the error-path test fail with two headers instead of one.

Because this writes during render and React may render a component more than once, it is safe
for "set this cookie to this computed value" and unsafe for anything order-dependent. In the
browser the hook is a no-op that warns once, so components need no `typeof window` guard.

Implements P1 of rfcs/SSR_REQUEST_CONTEXT.md.
