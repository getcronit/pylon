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
    : T extends {other: string}
      ? // A plural message is a LEAF, not a branch: `cart.items` is the key, and `one` /
        // `other` are its categories rather than keys of their own. Without this the type
        // system offers `cart.items.other` and rejects the key an app actually writes.
        ''
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
 * CLDR plural categories. Which apply depends on the locale — English uses `one`/`other`,
 * Polish adds `few`/`many`, Japanese uses only `other`.
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/**
 * A plural message: an object keyed by category rather than a string.
 *
 * ```ts
 * items: {one: '{count} item', other: '{count} items'}
 * ```
 *
 * Deliberately NOT ICU syntax (`{count, plural, one {#} other {#}}`). Catalogs are
 * TypeScript, so an object is the natural shape — it needs no parser, each branch stays an
 * ordinary interpolated string, and the categories are visible to the type system instead of
 * hidden inside a string literal. `other` is required because every locale has it.
 */
export type PluralMessage = {other: string} & Partial<Record<PluralCategory, string>>

/** Placeholders required by a message, whether it is a plain string or a plural object. */
export type MessageVars<M> = M extends string
  ? Vars<M>
  : M extends {other: string}
    ? 'count' | Vars<M[keyof M] & string>
    : never

/**
 * The argument list for a message: nothing when it has no placeholders, and a required,
 * exactly-typed object when it does.
 */
export type ArgsFor<M> = [MessageVars<M>] extends [never]
  ? []
  : [
      values: {
        [P in MessageVars<M>]: P extends 'count'
          ? // `count` drives plural selection, so it must be a number.
            number
          : string | number
      }
    ]

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

/**
 * Look up a dotted path, returning the raw node — a string, or a plural object.
 *
 * `undefined` on a miss rather than throwing.
 */
export const lookupNode = (messages: Messages, key: string): unknown => {
  let node: unknown = messages
  for (const part of key.split('.')) {
    if (!isPlainObject(node)) return undefined
    node = node[part]
  }
  return node
}

/** Look up a dotted path, for plain string messages. */
export const lookup = (messages: Messages, key: string): string | undefined => {
  const node = lookupNode(messages, key)
  return typeof node === 'string' ? node : undefined
}

/** Is this node a plural message rather than a plain string or a branch? */
export const isPluralMessage = (node: unknown): node is PluralMessage =>
  isPlainObject(node) && typeof (node as Record<string, unknown>).other === 'string'

// `Intl.PluralRules` construction is expensive; one per locale is plenty.
const pluralRules = new Map<string, Intl.PluralRules>()
const rulesFor = (locale: string): Intl.PluralRules => {
  let r = pluralRules.get(locale)
  if (!r) {
    r = new Intl.PluralRules(locale)
    pluralRules.set(locale, r)
  }
  return r
}

/**
 * Pick a plural branch for `count` in `locale`.
 *
 * Falls back to `other` when the locale selects a category the catalog does not define —
 * a Polish translation missing `few` renders `other` rather than the key.
 */
export const selectPlural = (
  message: PluralMessage,
  locale: string,
  count: number
): string => {
  const category = rulesFor(locale).select(count) as PluralCategory
  return message[category] ?? message.other
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
export interface TranslatorOptions {
  locale: string
  namespace?: string
  /**
   * Replace interpolation entirely — the ICU seam.
   *
   * Pylon's own syntax is `{placeholder}` plus category-keyed plurals, which covers most
   * apps with no dependency. An app needing full ICU (select, ordinals, nested formats)
   * plugs in `intl-messageformat` here rather than pylon taking the dependency for everyone:
   *
   * ```ts
   * import IntlMessageFormat from 'intl-messageformat'
   * formatMessage: (message, values, locale) =>
   *   new IntlMessageFormat(message, locale).format(values) as string
   * ```
   *
   * Receives the already-plural-selected branch, so the two compose.
   */
  formatMessage?: (
    message: string,
    values: Record<string, string | number> | undefined,
    locale: string
  ) => string
}

export const createTranslator = (messages: Messages, options: TranslatorOptions) => {
  const {locale, namespace, formatMessage} = options
  const prefix = namespace ? `${namespace}.` : ''

  return (key: string, values?: Record<string, string | number>): string => {
    const full = `${prefix}${key}`
    const node = lookupNode(messages, full)

    let message: string
    if (typeof node === 'string') {
      message = node
    } else if (isPluralMessage(node)) {
      const count = values?.count
      if (typeof count !== 'number') {
        if (typeof console !== 'undefined') {
          console.warn(`[pylon] '${full}' is a plural message and needs a numeric \`count\`.`)
        }
        message = node.other
      } else {
        message = selectPlural(node, locale, count)
      }
    } else {
      if (typeof console !== 'undefined') {
        console.warn(`[pylon] Missing translation: ${full}`)
      }
      return full
    }

    return formatMessage
      ? formatMessage(message, values, locale)
      : interpolate(message, values)
  }
}

// ---------------------------------------------------------------------------
// The ICU seam
// ---------------------------------------------------------------------------

let messageFormatter: TranslatorOptions['formatMessage']

/**
 * Replace interpolation with a full ICU formatter.
 *
 * Pylon's own syntax — `{placeholder}` plus category-keyed plurals — covers most apps with
 * no dependency. Apps needing select, ordinals or nested formats opt in:
 *
 * ```ts
 * // called at import time from a module BOTH sides load, e.g. the root layout
 * import IntlMessageFormat from 'intl-messageformat'
 * import {setMessageFormatter} from '@getcronit/pylon/pages'
 *
 * setMessageFormatter((message, values, locale) =>
 *   String(new IntlMessageFormat(message, locale).format(values))
 * )
 * ```
 *
 * A module-level setter rather than `usePages({i18n: {formatMessage}})` on purpose: config
 * is server-only and a function cannot travel in the hydration envelope, so a configured
 * formatter would format the SSR pass and not the hydration pass — every ICU message would
 * mismatch. Set from app code that both sides import and the two agree by construction.
 *
 * Receives the already-plural-selected branch, so it composes with category-keyed plurals.
 */
export const setMessageFormatter = (
  format: TranslatorOptions['formatMessage']
): void => {
  messageFormatter = format
}

/** @internal The formatter in effect, if any. */
export const getMessageFormatter = (): TranslatorOptions['formatMessage'] =>
  messageFormatter
