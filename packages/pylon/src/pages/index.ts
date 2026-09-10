// Runtime entry — `@getcronit/pylon/pages`. The browser-facing usePages runtime
// (useData, useMutation, Link, Image, StatusPage, global-id helpers). The runtime
// module itself is kept at ./pages/ for now; this barrel is its public entry so
// `@getcronit/pylon/pages` resolves to the runtime (a cosmetic flatten of the
// internal ./pages/pages nesting is an optional later follow-up).
//
// The CONFIG PLUGIN `usePages` lives at `@getcronit/pylon/pages/plugin` (plugin.ts).
export * from './pages/index.js'

/**
 * Where an app registers its message catalog:
 *
 * ```ts
 * // pylon.d.ts
 * declare module '@getcronit/pylon/pages' {
 *   interface Register {
 *     messages: (typeof import('./messages/en'))['default']
 *   }
 * }
 * ```
 *
 * A REGISTRY rather than `interface Catalog extends …` — that form is illegal
 * (TS2499: "An interface can only extend an identifier/qualified-name"), and because an app's
 * `pylon.d.ts` is a declaration file, `skipLibCheck: true` — which pylon's own scaffold sets
 * — suppresses the error entirely. The augmentation would silently do nothing and every
 * message key would resolve to `never` with no explanation. A property type may be any type
 * expression, so this form has no such restriction.
 */
export interface Register {}

/**
 * The app's message catalog, resolved from `Register`. Empty until registered, so
 * `useTranslations()` accepts no key — noisy by design rather than widening to `string` and
 * accepting typos.
 */
export type Catalog = Register extends {messages: infer M extends object} ? M : {}
