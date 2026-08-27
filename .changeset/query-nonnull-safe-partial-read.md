---
'@getcronit/pylon': patch
---

Stop a transiently-absent non-null field from crashing reads in pylon-query.

When a **non-null** object field (e.g. a `Connection`) momentarily drops out of the op result
during a refetch merge, the wrapper handed back a bare `undefined`, so a downstream
`x.totalCount` threw `Cannot read properties of undefined` — crashing the caller (a composer
mid-send, for instance). The schema says such a field can't be null, so `undefined` is a
transient partial read, not a real value.

The descriptor now carries a `nonNull` flag (emitted by `describeSchema`), and `wrapResult`
uses it: a genuinely **nullable** object still returns `null`/`undefined` for the app to guard
with `?.`, but a **non-null** object that is absent returns a null-safe sub-wrapper whose
nested reads degrade to `undefined` — so the read no longer throws (`reportPartialRead` still
logs the hole). Existing generated clients are unaffected until regenerated (absence of the
flag = the previous behavior).
