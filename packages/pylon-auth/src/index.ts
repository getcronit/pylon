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
 * The zero-dependency contract (Principal, IdentityProvider, helpers,
 * `ForbiddenError`) is also published at `@getcronit/pylon-auth/contract`, so the
 * ORM can depend on it without pulling core in. RESOURCE-tier authz (rows/
 * instances/fields → WhereInput) lives in pylon-app, which re-exports this and
 * extends `authorize` with resource forms.
 */
export {
  type Principal,
  type IdentityProvider,
  hasRole,
  hasPermission,
  ForbiddenError
} from './contract.js'

export {getPrincipal, authorize, requireRole, useIdentity} from './authz.js'
