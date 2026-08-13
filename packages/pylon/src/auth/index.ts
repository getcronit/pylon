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
 * instances/fields → WhereInput) lives in pylon-db.
 */
import type {Context} from '@getcronit/pylon'
import type {IdentityProvider as IdentityProviderBase} from './contract.js'

export {
  type Principal,
  hasRole,
  hasPermission,
  ForbiddenError
} from './contract.js'

/**
 * The identity seam, with `Ctx` defaulting to the Pylon request `Context` — so a
 * provider written `const auth: IdentityProvider = c => …` gets a fully typed `c`
 * (`c.req.header(...)`, `c.get(...)`). The zero-dep contract keeps the generic
 * `IdentityProvider<Ctx = unknown>` (the ORM imports that without pulling core in).
 */
export type IdentityProvider<Ctx = Context> = IdentityProviderBase<Ctx>

export {getPrincipal, authorize, requireRole, useIdentity} from './authz.js'
