/**
 * Shopify-style mutation payloads. Wrap a mutation resolver with `mutation()` so
 * EXPECTED, user-facing failures become DATA (`userErrors`) rather than thrown
 * GraphQL errors:
 *
 *   export const Mutation = {
 *     productCreate: mutation(async (input: ProductInput) => {
 *       const product = await Product.objects.create(input)  // may throw ValidationError
 *       if (await skuTaken(input.sku))
 *         throw new ServiceError('SKU in use', {code: 'SKU_TAKEN', statusCode: 409, details: {field: ['sku']}})
 *       return {product}
 *     })
 *   }
 *
 * On success: `{product, userErrors: []}`. On a ValidationError (from the ORM) or
 * a ServiceError (business rule): `{userErrors: [...]}` with the entity null.
 * Anything else rethrows (unexpected → masked / Sentry). The wrapped return type
 * carries `userErrors`, so the type-introspection build adds it to the payload.
 *
 * The wrapper's mapped return type makes every payload field nullable
 * (`{[K in keyof Awaited<R>]: Awaited<R>[K] | null}`), so the entity is correctly
 * derived as NULLABLE in the schema (null on the error path). This is verified
 * end-to-end against the real SchemaBuilder — including object/entity references
 * through the ORM `mergeIR` contribution — in pylon-db's `schema-derivation`
 * suite (the `[#43]` cases).
 */
import {ServiceError} from './define-pylon'

export interface UserError {
  /** Path to the offending input field (e.g. `['address','zip']`). */
  field: string[]
  message: string
  /** Stable machine code (validation code, or a business code). */
  code: string
}

/** Structural check for pylon-db's ValidationError (no cross-package import). */
function validationIssues(
  err: unknown
): Array<{path?: string; code?: string; message?: string}> | null {
  const issues = (err as {issues?: unknown})?.issues
  if (Array.isArray(issues) && issues.every(i => i && typeof i.message === 'string')) {
    return issues as Array<{path?: string; code?: string; message?: string}>
  }
  return null
}

/** Map a thrown error to userErrors, or null if it's unexpected (rethrow). */
function toUserErrors(err: unknown): UserError[] | null {
  const issues = validationIssues(err)
  if (issues) {
    return issues.map(i => ({
      field: i.path ? i.path.split('.') : [],
      message: i.message ?? 'Invalid value',
      code: i.code ?? 'invalid'
    }))
  }
  if (err instanceof ServiceError) {
    const details = err.extensions?.details as {field?: string[]} | undefined
    return [
      {
        field: details?.field ?? [],
        message: err.message,
        code: String(err.extensions?.code ?? 'ERROR')
      }
    ]
  }
  return null
}

/**
 * Wrap a mutation resolver so user-facing errors surface as `userErrors`. The
 * payload entity is optional (null on failure); `userErrors` is always present.
 */
export function mutation<A extends any[], R>(
  fn: (...args: A) => R | Promise<R>
): (...args: A) => Promise<
  {[K in keyof Awaited<R>]: Awaited<R>[K] | null} & {userErrors: UserError[]}
> {
  return async (...args: A) => {
    try {
      const result = await fn(...args)
      return {...(result as object), userErrors: []} as any
    } catch (err) {
      const userErrors = toUserErrors(err)
      if (userErrors) return {userErrors} as any
      throw err
    }
  }
}
