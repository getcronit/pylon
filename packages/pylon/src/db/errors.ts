/**
 * ORM error types the framework integration recognizes and surfaces cleanly
 * (instead of masking them to "Unexpected error").
 *
 * `ValidationError` (in validation.ts) covers input/constraint issues — including
 * unique violations (23505), mapped to a `'unique'` field issue. This module adds
 * `NotFoundError` for lookups (`.get()` miss). The `useDatabase` plugin maps it to
 * a `NOT_FOUND` GraphQL error; resolvers need no error handling for it.
 *
 * Kept ORM-local (no `@getcronit/pylon` import) so the migration CLI / build stay
 * decoupled. The shape (`code` + `statusCode`) mirrors a Pylon `ServiceError`.
 */

/** A lookup found no row (e.g. `Model.objects.get(...)` matched nothing). */
export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND'
  readonly statusCode = 404
  constructor(
    /** The entity/table that was queried. */
    readonly entity: string,
    /** The criteria that matched nothing (for the message / debugging). */
    readonly criteria?: Record<string, unknown>
  ) {
    super(`${entity} not found`)
    this.name = 'NotFoundError'
  }
}

/** Client sent something malformed — e.g. an unparseable or wrong-type global id. */
export class BadRequestError extends Error {
  readonly code = 'BAD_REQUEST'
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}

/**
 * A write violated a foreign-key constraint (SQLSTATE 23503) — it referenced a row that
 * doesn't exist. Postgres reports this as an opaque `violates foreign key constraint
 * "<hash>"`; this carries a message a human can act on (WHICH id, in WHICH relation, is
 * missing) with the driver error kept as `cause`.
 */
export class ForeignKeyViolationError extends Error {
  readonly code = 'FOREIGN_KEY_VIOLATION'
  readonly statusCode = 409
  readonly constraint?: string
  readonly column?: string
  readonly value?: string
  constructor(
    message: string,
    options: {
      cause?: unknown
      constraint?: string
      column?: string
      value?: string
    } = {}
  ) {
    super(message, options.cause !== undefined ? {cause: options.cause} : undefined)
    this.name = 'ForeignKeyViolationError'
    this.constraint = options.constraint
    this.column = options.column
    this.value = options.value
  }
}

/**
 * Map a Postgres foreign-key violation (23503) to a `ForeignKeyViolationError` whose message
 * NAMES the missing reference — read from the driver's `detail`
 * (`Key (<col>)=(<val>) is not present in table "<table>".`) and, where a `columns` map is
 * given, the human label for that column (e.g. the model on that side of a join). Returns
 * `undefined` for any other error so callers can `?? err` to rethrow the original.
 */
export function foreignKeyViolation(
  err: unknown,
  ctx: {
    /** What the write was doing, e.g. `link ProductOptionValue ↔ ProductVariant`. */
    action: string
    /** Column name → human label (e.g. join column → the referenced model's name). */
    columns?: Record<string, string>
  }
): ForeignKeyViolationError | undefined {
  const e = err as {code?: string; detail?: string; constraint?: string}
  if (e?.code !== '23503') return undefined
  const m = e.detail?.match(
    /Key \(([^)]+)\)=\(([^)]+)\) is not present in table "?([^")]+)"?/
  )
  const column = m?.[1]
  const value = m?.[2]
  const missingTable = m?.[3]
  const refLabel = (column && ctx.columns?.[column]) || missingTable || 'referenced row'
  const what = value ? `${refLabel} "${value}" does not exist` : `a referenced ${refLabel} does not exist`
  return new ForeignKeyViolationError(
    `Cannot ${ctx.action}: ${what}. It was referenced but not found — likely created out of ` +
      `order, or removed earlier in the same operation.`,
    {cause: err, constraint: e.constraint, column, value}
  )
}
