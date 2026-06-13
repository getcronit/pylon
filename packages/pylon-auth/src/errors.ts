/**
 * The canonical authorization error — owned by pylon-auth (authz depends on the
 * auth contract). Thrown by capability gates here AND by pylon-db's row policies
 * / feature gates, so there is ONE class everywhere. Zero-dependency (no core),
 * so the ORM can import it from `@getcronit/pylon-auth/contract` without pulling
 * the web framework in. Surfaced to clients as a `FORBIDDEN` GraphQL error.
 */
export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN'
  readonly statusCode = 403
  constructor(
    message = 'Not permitted.',
    /** Set when the denial is a feature gate (pylon-db `requireFeature`). */
    readonly feature?: string
  ) {
    super(message)
    this.name = 'ForbiddenError'
  }
}
