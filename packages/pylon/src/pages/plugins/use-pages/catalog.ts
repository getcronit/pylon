/**
 * Message catalogs — P3 of rfcs/SSR_I18N.md.
 *
 * The default-locale catalog is a `.ts` module with `as const`, which is what makes the key
 * space AND each message's placeholders recoverable by pure inference. No codegen, no
 * generated `.d.ts`, nothing to run before the editor is correct:
 *
 * ```ts
 * // messages/en.ts
 * export default {
 *   nav: {home: 'Home'},
 *   checkout: {total: 'Total: {amount} for {count} items'}
 * } as const
 * ```
 *
 * JSON cannot do this — `resolveJsonModule` widens every value to `string`, so the
 * placeholder names are gone before the type system sees them. Translations may still be
 * JSON, because they only need to match the default catalog's SHAPE and a widened `string`
 * leaf satisfies that (see `SameShape`).
 */

/**
 * A translation of `T`: identical shape, but each leaf may be any string.
 *
 * ```ts
 * const de = {...} satisfies SameShape<typeof en>   // missing key → compile error
 * ```
 *
 * Works for a JSON import too, which is how a TMS round-trip keeps its missing-key check
 * without any build step.
 */
export type SameShape<T> = {
  [K in keyof T]: T[K] extends string ? string : SameShape<T[K]>
}

// ---------------------------------------------------------------------------
// Key + placeholder inference
// ---------------------------------------------------------------------------

type Join<K, P> = K extends string
  ? P extends string
    ? P extends ''
      ? K
      : `${K}.${P}`
    : never
  : never

/**
 * Countdown used to bound `Paths` recursion.
 *
 * Without a budget TypeScript will chase a generic `T` forever and fail with "Type
 * instantiation is excessively deep" — not a slow build, an outright error. It also caps the
 * compile-time cost on large catalogs, which is the one real risk this inference-over-codegen
 * approach carries. Ten levels is far past any sane catalog; deeper keys simply stop being
 * offered rather than breaking the build.
 */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** Every dotted leaf path of `T` — `'nav.home' | 'checkout.total'`. */
export type Paths<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends string
    ? ''
    : {[K in keyof T]-?: Join<K, Paths<T[K], Prev[D]>>}[keyof T]

/** The message literal at a dotted path. */
export type At<T, P extends string> = P extends `${infer H}.${infer R}`
  ? H extends keyof T
    ? At<T[H], R>
    : never
  : P extends keyof T
    ? T[P]
    : never

/**
 * Placeholder names inside a message literal — `'Total: {amount} for {count}'` yields
 * `'amount' | 'count'`. This is the part JSON forfeits.
 */
export type Vars<S extends string> = string extends S
  ? // A WIDENED `string` (a JSON import, or a catalog missing `as const`) has no literal to
    // destructure, and recursing on it makes TypeScript chase an infinite template — a real
    // "Type instantiation is excessively deep" error, not a slow build. Bail out: such a
    // message simply reports no placeholders.
    never
  : S extends `${string}{${infer V}}${infer Rest}`
    ? V | Vars<Rest>
    : never

/**
 * The argument list for a message: nothing when it has no placeholders, and a required,
 * exactly-typed object when it does.
 */
export type ArgsFor<M> = [Vars<M & string>] extends [never]
  ? []
  : [values: {[P in Vars<M & string>]: string | number}]

/**
 * The pieces a translate signature is built from live here; the SIGNATURE itself is written
 * at the hook, against the concrete `Catalog`.
 *
 * A generic `Translate<T>` alias cannot work: TypeScript evaluates `Paths<T>` for a generic
 * `T` while checking the alias declaration and fails with "Type instantiation is excessively
 * deep" — before any app calls it, and whether or not `T` is constrained. Instantiated at a
 * concrete catalog (which is all `useTranslations` ever does) the same types are fine.
 */

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** Loaded messages for one locale — nested, mirroring the catalog module. */
export type Messages = Record<string, unknown>

/** A catalog module, or a function returning one (so it can be `() => import(...)`). */
export type CatalogSource =
  | Messages
  | (() => Messages | Promise<Messages | {default: Messages}>)
  | Promise<Messages | {default: Messages}>

/** Resolve a configured catalog source to plain messages. */
export const loadCatalog = async (source: CatalogSource): Promise<Messages> => {
  const resolved = typeof source === 'function' ? await source() : await source
  return (resolved as {default?: Messages})?.default ?? (resolved as Messages)
}

/**
 * Deep-merge `fallback` under `messages`.
 *
 * The fallback is applied ONCE, on the server, and the merged result is what ships. So the
 * browser needs no fallback logic and — more importantly — only ever receives ONE catalog,
 * rather than the active locale plus the default to fall back through.
 */
export const mergeCatalogs = (fallback: Messages, messages: Messages): Messages => {
  const out: Messages = {...fallback}
  for (const [key, value] of Object.entries(messages)) {
    const base = out[key]
    out[key] =
      isPlainObject(base) && isPlainObject(value)
        ? mergeCatalogs(base as Messages, value as Messages)
        : value
  }
  return out
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Look up a dotted path. Returns `undefined` rather than throwing on a miss. */
export const lookup = (messages: Messages, key: string): string | undefined => {
  let node: unknown = messages
  for (const part of key.split('.')) {
    if (!isPlainObject(node)) return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * Substitute `{name}` placeholders.
 *
 * An unknown placeholder is left verbatim rather than replaced with `undefined`: a visible
 * `{count}` in the UI says exactly what is wrong, where the string "undefined" does not.
 */
export const interpolate = (
  message: string,
  values?: Record<string, string | number>
): string =>
  values
    ? message.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in values ? String(values[name]) : whole
      )
    : message

/**
 * Build a translate function over `messages`.
 *
 * A missing key returns the key itself. That is deliberate: it renders something traceable,
 * keeps the page up, and is greppable — where an empty string silently deletes UI and a
 * throw takes down a page over a copy edit. The server-side merge means "missing" here can
 * only mean missing from BOTH the active locale and the default.
 */
export const createTranslator = (messages: Messages, namespace?: string) => {
  const prefix = namespace ? `${namespace}.` : ''
  return (key: string, values?: Record<string, string | number>): string => {
    const full = `${prefix}${key}`
    const message = lookup(messages, full)
    if (message === undefined) {
      if (typeof console !== 'undefined') {
        console.warn(`[pylon] Missing translation: ${full}`)
      }
      return full
    }
    return interpolate(message, values)
  }
}
