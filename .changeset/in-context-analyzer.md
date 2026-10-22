---
'@getcronit/pylon': minor
---

Compiled documents carry `@inContext`, so resolvers are locale-correct with no per-query
wiring.

```ts
Query: {
  productName: async (id: number): Promise<string> =>
    (await ProductTranslation.objects
      .filter({productId: id, locale: getLocale() ?? 'en'})
      .first())?.name ?? (await Product.objects.get({id})).name
}
```

```tsx
const data = useData()
data.product({id}).name        // German on /de, French on /fr — nothing passed at the call site
```

With `usePages({i18n})` configured, every operation the analyzer compiles is emitted as
`query page_0($__locale: String) @inContext(locale: $__locale)`, and the query client supplies
the locale. Queries and mutations both — a mutation returns localized content too.

The locale is held **per client**, not in a module-level variable: the SSR pass builds one
client per request, so concurrent renders in different locales cannot bleed into each other.
The browser has one client and one locale, because switching locale is a document navigation.

It is merged into the variables **before** the cache key is computed, at every entry point
that computes one (`fetch`, `ensure`, `revalidate`, `refetch`) — otherwise one path would read
a different slot than another wrote. Verified end to end:

```
qd09ab19da988723b~1emsiz4  →  {"serverGreeting": "Server: hallo"}
qd09ab19da988723b~1emubph  →  {"serverGreeting": "Server: bonjour"}
```

Same document, different variables hash. With the locale in a header these would have been one
entry, and one language would have served the other's data.

Documented in the i18n guide, including why a resolver cannot simply read the page's request
context: the SSR pass reaches GraphQL through a separate in-process request, and after
hydration there is no page request at all.
