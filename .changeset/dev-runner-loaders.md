---
'@getcronit/pylon': patch
---

`pylon dev`: externalize all node_modules in the backend runner + add JSON/CSS loader hooks.

The dev runner now sets `ssr.external: true` so every dependency loads natively through Node
instead of Vite's SSR transform — routing CJS packages through the transform ESM-ifies them and
breaks their dynamic `require`s. That native-load path then needs two Node module hooks (registered
before the app boots):

- **JSON** — Node's ESM loader requires an explicit `with { type: 'json' }` attribute, so a
  dependency doing a bare `require('./x.json')` (e.g. `i18n-iso-countries`'s `langs/*.json`) threw
  `ERR_IMPORT_ATTRIBUTE_MISSING`. The resolve hook stamps `type: 'json'` on `.json` URLs.
- **CSS** — a server-side `import 'pkg/x.css'` is meaningless for SSR (styles ship via the client
  build) and Node can't load `.css`; the load hook returns an empty module instead of crashing.

Together with keeping node_modules external in the build, this lets apps that pull in packages with
dynamic data `require`s or bare CSS imports run `pylon dev` and `pylon build`.
