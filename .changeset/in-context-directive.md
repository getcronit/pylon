---
'@getcronit/pylon': minor
---

`@inContext` — per-operation request context, read by resolvers.

```graphql
query Products($__locale: String) @inContext(locale: $__locale) {
  products { name }
}
```

```ts
import {getLocale} from '@getcronit/pylon'

Query: {
  greeting: (): string => translations[getLocale() ?? 'en'] ?? translations.en
}
```

The directive is defined in every emitted schema, read in `onExecute`, and exposed to
resolvers through `getLocale()` / `getInContext()`. A locale may be an inline literal or a
variable; the variable form is what compiled documents will use, so one document serves every
locale.

**Why a directive rather than an HTTP header.** `pylon-query` keys its store on
`documentId ~ variablesHash(variables)` and nothing else. With the locale in a header, the
same document with the same variables would be the same cache entry — English and German
results colliding on one key, in the client store and the hydration envelope alike. Putting
the context in the document makes it part of the cache key by construction. Shopify's
Storefront API arrived at the same directive for the same reason.

`getLocale()` returns `undefined` when the operation states no locale, rather than defaulting:
the caller did not ask, so the resolver decides what neutral means.

This is the server half. Automatic injection into `useData`-compiled documents — so a pages
app gets locale-correct resolvers with no per-query wiring — is the remaining piece.
