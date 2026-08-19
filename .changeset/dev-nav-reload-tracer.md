---
'@getcronit/pylon': patch
---

Add a dev navigation/reload-loop tracer.

In development the client bootstrap now wraps `location.reload()` / `assign` / `replace` / the
`href` setter. On rapid repeated full-page reloads it logs the caller stack, and after a short
burst it SUPPRESSES further reloads — so a reload loop breaks instead of spinning forever, and
the exact caller (a resolver-triggered write, a Vite re-optimize, app code, …) is visible in
the console. Dev-only; never in the production build.
