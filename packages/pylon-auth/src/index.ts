/**
 * @getcronit/pylon-auth — the AUTH layer for Pylon.
 *
 * Owns the request actor (`Principal`), the identity seam (`IdentityProvider`,
 * `useIdentity`), and CAPABILITY-tier authorization (`authorize`, `requireRole`,
 * `hasRole`, `hasPermission`) — everything you need to secure a resolver or route
 * with core + an identity provider, NO ORM. It's auth-mechanism-agnostic: the
 * helpers take the rule as an argument (no permissions are hardcoded), and any
 * provider (Zitadel, custom JWT, API key) fills the Principal via `useIdentity`.
 *
 * RESOURCE-tier authz (rows/instances/fields → WhereInput) lives in pylon-app,
 * which re-exports this and extends `authorize` with resource forms.
 */
export {
  type Principal,
  type IdentityProvider,
  hasRole,
  hasPermission
} from './principal.js'

export {ForbiddenError, getPrincipal, authorize, requireRole, useIdentity} from './authz.js'
