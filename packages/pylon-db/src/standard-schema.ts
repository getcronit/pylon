/**
 * Standard Schema adapter — bring your own validation library (Zod, Valibot,
 * ArkType, …) to a field, without the ORM ever depending on it.
 *
 * We deliberately code against the **Standard Schema v1** spec
 * (https://standardschema.dev) rather than Zod's concrete API: it is a tiny,
 * dependency-free interface (a single `~standard` property) that Zod ≥3.24,
 * Valibot and ArkType all implement. So this file vendors only the spec's
 * *types* — there is NO runtime dependency on any validation library, and the
 * same adapter serves all of them. A `safeParse` fallback covers classic/older
 * Zod that predates Standard Schema.
 *
 * The decision still stands: Zod is NOT in the ORM core and NOT in its public
 * API surface. This is the opt-in escape hatch for richer rules / nicer
 * messages than the built-in `min`/`max`/`pattern`/`email` field options.
 */
import type {ValidationIssue} from './validation.js'

// ── Vendored Standard Schema v1 types (no runtime dependency) ────────────────

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaProps<Input, Output>
}

export interface StandardSchemaProps<Input, Output> {
  readonly version: 1
  readonly vendor: string
  readonly validate: (
    value: unknown
  ) => StandardResult<Output> | Promise<StandardResult<Output>>
  readonly types?: {readonly input: Input; readonly output: Output} | undefined
}

export type StandardResult<Output> =
  | {readonly value: Output; readonly issues?: undefined}
  | {readonly value?: undefined; readonly issues: ReadonlyArray<StandardIssue>}

export interface StandardIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | {readonly key: PropertyKey}>
}

/** Classic Zod-style schema (pre-Standard-Schema) — supported as a fallback. */
export interface ZodLikeSchema {
  safeParse(value: unknown):
    | {success: true; data: unknown}
    | {success: false; error: {issues: ReadonlyArray<StandardIssue>}}
}

/** What a field's `schema` option accepts — any Standard Schema or classic Zod. */
export type FieldSchema = StandardSchemaV1<any, any> | ZodLikeSchema

// ── Adapter: run a schema and map its issues into structured ValidationIssues ─

const isPromise = (v: unknown): v is Promise<unknown> =>
  typeof (v as {then?: unknown} | null)?.then === 'function'

const segmentKey = (seg: PropertyKey | {readonly key: PropertyKey}): PropertyKey =>
  typeof seg === 'object' && seg !== null ? seg.key : seg

/**
 * Validate `value` against `schema`, returning structured issues rooted at
 * `path`. Nested issue paths (object/array schemas) are dotted under it
 * (`address.zip`). Schema issues carry code `custom` — the library owns the
 * message, which is exactly why callers reach for it (better messages than the
 * built-in rules). Synchronous only: an async schema throws a clear error.
 */
export function validateWithSchema(
  path: string,
  schema: FieldSchema,
  value: unknown
): ValidationIssue[] {
  let result: StandardResult<unknown>

  const standard = (schema as StandardSchemaV1)['~standard']
  if (standard && typeof standard.validate === 'function') {
    const r = standard.validate(value)
    if (isPromise(r)) {
      throw new Error(
        `Field "${path}": async schema validation is not supported — use a synchronous schema.`
      )
    }
    result = r
  } else if (typeof (schema as ZodLikeSchema).safeParse === 'function') {
    const parsed = (schema as ZodLikeSchema).safeParse(value)
    if (parsed.success) return []
    result = {issues: parsed.error.issues}
  } else {
    // Not a recognized schema shape — ignore rather than crash the write.
    return []
  }

  if (!result.issues) return []
  return result.issues.map(issue => {
    const sub = (issue.path ?? []).map(seg => String(segmentKey(seg))).join('.')
    return {
      path: sub ? `${path}.${sub}` : path,
      code: 'custom' as const,
      message: issue.message
    }
  })
}
