---
'@getcronit/pylon': patch
---

Eliminate partial reads in pylon-query at the root with a completeness gate.

A normalized cache shares entities across operations, so one query could read a
`Ticket:1` that a *narrower* query had populated without a field it selected (a
non-destructive merge never dropped it — it was simply never added yet). The
missing field surfaced as `undefined` and crashed downstream reads
(`x.totalCount`) — the "partial read" bug, previously papered over with a
null-safe wrapper and `?.` guards at call sites.

The fix adopts Relay's rule: **only ever render an operation whose entire
selection is present in the store.** The compiler now emits a compact selection
`shape` on each query document (derived from the finished wire body, so it stays
in lockstep — and parsed at build time, so the runtime ships no GraphQL parser).
At read time `client.ensure` checks the cached data against that shape via
`isSatisfied`; a present-but-incomplete operation suspends and refetches instead
of handing a hole to component code. Complete-but-stale data still serves
immediately (SWR is unchanged — no over-suspend flash on mutations), a
present-but-`null` field counts as satisfied (feature-gated / nullable values are
real answers), and a one-shot backstop prevents any refetch loop.

With holes now structurally impossible on the render path, the previous
workarounds are removed: the `nonNull` safe-wrapper, the `nonNull` descriptor
flag, and the `reportPartialRead` dev instrumentation. Hand-authored and mutation
documents carry no shape and are ungated (unchanged behavior).
