---
'@getcronit/pylon': minor
---

Pages: `canonical` can be turned off, and no longer depends on `i18n`.

**`usePages({canonical: false})`** hands the tag to the app.

The default stays on and is right for most sites — the canonical is the page's
own URL, and a self-referencing one is always safe. But it is derived from the
request path, and two things the framework cannot know sometimes make that
wrong:

- **which query parameters matter.** `?page=2` is a different set of items and
  belongs in the canonical; `?colour=red` is a filtered view of the same set and
  does not. They are indistinguishable from here.
- **that two routes serve one thing**, so one should nominate the other.

Rendering your own alongside is not a workaround: React appends `<link>` to
`<head>` rather than replacing it, and does not deduplicate by `id` or `key`
(measured — three canonicals survive, two with identical ids). Search engines
discard conflicting canonicals outright, so the page ends up worse than before.
Hence a flag rather than an override.

**Canonical no longer requires `i18n`.** The two shared one condition:

```ts
options.origin && i18n && (context.statusCode ?? 200) < 400
```

Alternates need `i18n` — locale basenames are the whole point. A canonical does
not; it is this page's own URL. So a single-locale site configured with `origin`
was emitting neither, which is the more clearly wrong half of the coupling.
`hreflang` is unchanged.
