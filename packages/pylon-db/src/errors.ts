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
