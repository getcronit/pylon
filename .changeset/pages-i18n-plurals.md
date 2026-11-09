---
'@getcronit/pylon': minor
---

Plural messages, and an opt-in seam for full ICU.

```ts
// messages/en.ts
checkout: {items: {one: '{count} item', other: '{count} items'}}
```

```tsx
t('items', {count: 7})   // "7 items"
```

A plural message is an object keyed by CLDR category rather than an ICU string. Catalogs are
TypeScript, so an object is the natural shape: no parser ships, each branch stays an ordinary
interpolated string, and the categories are visible to the type system instead of hidden
inside a string literal. `Intl.PluralRules` selects against the ACTIVE locale — Polish picks
`few` for 2–4 where English says `other` — and falls back to `other` when a translation omits
the selected category, so a partly-translated catalog still renders.

Typing follows: `cart.items` is the key (a plural object is a leaf, not a branch, so
`cart.items.other` is not offered), `count` is required, and it must be a `number` because it
drives the selection.

Full ICU — select, ordinals, nesting — is opt-in via `setMessageFormatter()`:

```ts
import IntlMessageFormat from 'intl-messageformat'
setMessageFormatter((message, values, locale) =>
  String(new IntlMessageFormat(message, locale).format(values))
)
```

A module-level setter rather than a config option, deliberately: config is server-only and a
function cannot travel in the hydration envelope, so a configured formatter would format the
SSR pass and not the hydration pass — mismatching every ICU message. Called from app code both
sides import, the two agree by construction. The formatter receives the already-selected
plural branch, so the two compose.
