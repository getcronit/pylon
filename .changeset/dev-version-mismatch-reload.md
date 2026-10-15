---
'@getcronit/pylon': patch
---

Fix an infinite reload loop in dev on pages that refetch on mount.

The query fetcher reloads the page when a response's `X-Pylon-Version` header differs from the
client's `window.__PYLON_VERSION__` (a production signal to pull a fresh client after a deploy).
In dev the client is stamped `'dev'` while the server sends the content-hashed pages-manifest
version, so they ALWAYS differ — and any page that refetches on mount (e.g. `usePaginatedData`'s
SWR revalidation) looped: fetch → version mismatch → reload → refetch → reload. The check now
no-ops in dev (client version `'dev'`), where HMR handles updates.
