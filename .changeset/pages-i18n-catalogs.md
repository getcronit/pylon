---
'@getcronit/pylon': minor
---

Message catalogs with typed keys AND typed placeholders — no codegen.

```ts
usePages({i18n: {locales: ['en', 'de', 'fr'], defaultLocale: 'en', catalogs: './messages'}})
```

```tsx
const t = useTranslations('checkout')
t('total', {amount: '12.00', count: 3})
```

The default-locale catalog is a `.ts` module with `as const`, which keeps the message
literals and makes both the key space and each message's placeholder names recoverable by
inference. A typo'd key, a missing placeholder, a spurious one, placeholders passed to a
message that takes none, or an unknown namespace are all compile errors — with no generated
file and nothing to run before the editor is correct. Translations may be `.ts` or `.json`;
only the default catalog must be `.ts`, because it is the type source.

`catalogs` is a DIRECTORY, and the build owns it: `usePages`'s build hook compiles
`<dir>/<locale>` into `.pylon/messages/`, so catalogs live wherever the app likes. Passing
pre-imported objects cannot work — only `src/**` is transpiled into `.pylon/`, so a catalog
imported from `pylon.config.ts` resolves at runtime to a file that was never emitted.

Catalogs are server-only. The active locale's messages travel in the hydration envelope as
data, and switching locale is a document navigation, so the browser never needs a second
catalog — "only the active locale ships" holds by construction, and an e2e asserts no other
locale's copy appears in the client bundle. Fallback to the default locale is resolved once on
the server, so the browser receives a single complete catalog rather than two to search.

Also adds `useFormatter()` — `Intl.NumberFormat`/`DateTimeFormat`/`RelativeTimeFormat` bound
to the active locale and memoised per options.

Apps register the catalog through `interface Register { messages: … }` rather than
`interface Catalog extends …`: the latter is illegal (TS2499) and, because `pylon.d.ts` is a
declaration file, `skipLibCheck` hides the error — the augmentation would silently do nothing
and every key would resolve to `never`.
