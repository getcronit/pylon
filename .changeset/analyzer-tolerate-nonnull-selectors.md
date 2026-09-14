---
'@getcronit/pylon': patch
---

Let the usePaginatedData selector analyzer see through type-only wrappers.

A connection selector on a nullable single-entity lookup —
`usePaginatedData(q => q.post({ id })!.comments)` — needs a `!` (or an `as`) to satisfy the
type-checker, since the client types a single-entity accessor as nullable. But the selector
path walker only recognized identifiers, property accesses, calls, and parentheses, so the
`NonNullExpression` made it bail with "usePaginatedData expects a connection selector".

The walker now sees through `NonNullExpression` and `AsExpression` (both erased at runtime, so
the connection PATH is unchanged), matching the non-paginated `useData` analyzer, which already
strips non-null assertions.
