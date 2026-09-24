---
'@getcronit/pylon': minor
---

`<Link locale>` — cross-locale links, i.e. the language switcher.

```tsx
<Link locale="de">Deutsch</Link>                      {/* this page, in German */}
<Link href="/pricing" locale="fr">Tarifs</Link>       {/* a specific page, in French */}
```

A plain `<Link>` is confined to the active locale by React Router's `basename`, which is
right for navigation and useless for switching language: from `/de`, `<Link href="/pricing">`
can only ever mean `/de/pricing`. `locale` crosses that boundary, resolving through every
locale's basename — which `negotiate()` now precomputes and ships in the hydration envelope
as `basenames`, so the browser never re-derives the rule from config it would have to be told
about.

Crossing locales renders a plain `<a>` — a full document navigation — on purpose. A
client-side transition would leave everything the server rendered in the OLD language in
place: `<html lang>`, SSR-resolved copy, and the hydration envelope. The other language is a
different document, so it is fetched as one. The anchor carries `hreflang`, and React
Router-only props (`replace`, `preventScrollReset`, `relative`, `viewTransition`, …) are
stripped rather than leaked onto the DOM.

A `locale` equal to the active one is not a switch and stays an ordinary router link, so
client-side navigation is unaffected. An unconfigured locale falls through to a normal link
rather than emitting a broken URL.
