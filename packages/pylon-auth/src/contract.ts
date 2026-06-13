/**
 * @getcronit/pylon-auth/contract — the ZERO-DEPENDENCY auth contract.
 *
 * The Principal shape, the identity seam, the pure null-safe helpers, and the
 * canonical `ForbiddenError`. Imports nothing from core, so layers BELOW the web
 * runtime — notably the ORM (pylon-db's row policies / feature gates) — can
 * depend on the auth contract and throw the one `ForbiddenError` without pulling
 * the framework in. The full package entry (`.`) adds the request-bound,
 * core-dependent gates (`getPrincipal`/`authorize`/`requireRole`/`useIdentity`).
 */
export {
  type Principal,
  type IdentityProvider,
  hasRole,
  hasPermission
} from './principal.js'

export {ForbiddenError} from './errors.js'
