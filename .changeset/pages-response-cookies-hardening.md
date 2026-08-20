---
'@getcronit/pylon': patch
---

Harden `useResponseCookies()`: secure defaults, name validation, and shared-cache protection.

Probing the API with hostile input found no injection — Hono percent-encodes cookie values, so
`\r\n` becomes `%0D%0A` and `;` becomes `%3B`, neither of which can start a new header or a
new cookie attribute. Three real gaps around it are now closed:

- **Defaults.** Cookies were emitted with `Path=/` and nothing else. `SameSite=Lax` is now the
  default (blocking the cookie on cross-site subrequests while keeping it on top-level
  navigations), and `Secure` is added when the request arrived over TLS — detected from the
  URL scheme or `x-forwarded-proto`, so `http://localhost` in development is unaffected. An
  explicit option always wins.
- **Invalid cookie names 500'd the page from the wrong place.** The flush runs after the
  render, outside its try/catch, so a name containing CRLF reached the platform and threw an
  opaque `Headers.append` TypeError that took the whole response down. Names are now validated
  in `set()` against the RFC 6265 token grammar, so the error is raised inside the render where
  the stack names the offending component and the error boundary can handle it.
- **A response carrying `Set-Cookie` had no `Cache-Control`.** If a shared cache stored it, one
  visitor's cookie would be replayed to every other visitor. Responses that set cookies are now
  marked `private, no-cache`, unless the app has already chosen its own policy.

Note this API is for non-secret, client-readable state — theme, sidebar, locale. It sets no
`HttpOnly` default because such cookies are usually read by the client too; it is not the
right tool for session or auth tokens.
