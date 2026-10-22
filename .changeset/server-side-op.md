---
'@getcronit/pylon': minor
---

Server-side `op`: a `pages/sitemap.ts` can now fetch its URLs from the app's own GraphQL.

The imperative `op.query` / `op.mutation` were browser-only — their client was registered
under `typeof window !== 'undefined'`, so calling `op` from a sitemap module threw
"no client registered for `op` … imperative ops are browser-only" and `/sitemap.xml` 500'd.
This restored what the old generated `resolve()` used to allow before the `resolve → op`
migration.

`op` now consults a request-scoped client resolver before the browser singleton. The pages
runtime binds a per-request client — the in-process GraphQL fetcher that forwards the request's
headers, the same one SSR `useData` uses — in `AsyncLocalStorage` around the sitemap
invocation, so concurrent requests never share a client or its entity store. The seam
(`setOperationClientResolver`) generalizes to any non-React server caller (queue jobs, an RSS
route).

The `op` analyzer also accepts a **destructured root** now — `op.query(({products}) => products(…))`
compiles the same as `op.query(q => q.products(…))`, including aliases (`{products: p}`) and nested
patterns. Previously only a single named root param was analyzable.
