/**
 * The canonical actor for a request. Produced by an IDENTITY PROVIDER (any auth
 * mechanism) and bound on the request; everything downstream — capability gates
 * here, resource authz in pylon-app, ORM policies — authorizes against it. A
 * plain, serializable data shape, so helpers are free functions.
 */
export interface Principal {
  /** Stable unique id of the actor (user id, service-account id). */
  id: string | number
  /** Tenant the actor belongs to (e.g. organizationId) — also drives ORM tenant scoping. */
  tenant?: string | number
  /** Coarse roles (RBAC). */
  roles?: readonly string[]
  /** Fine-grained permissions, e.g. `invoice:write` (PBAC). */
  permissions?: readonly string[]
  /** Arbitrary claims for attribute-based rules (ABAC). */
  attributes?: Record<string, unknown>
}

/**
 * Turns a request into the current Principal (or `undefined` for public access).
 * The ONE seam for any auth mechanism — OIDC/Zitadel, custom JWT, API key,
 * session cookie, mTLS. `Ctx` is the host request context (Hono `Context`).
 * Swapping providers never touches a gate, policy, model, or resolver.
 */
export type IdentityProvider<Ctx = unknown> = (
  context: Ctx
) => Principal | undefined | Promise<Principal | undefined>

/**
 * The request-context key the bound Principal lives under. Shared so layers below
 * the web runtime (the ORM's `useDatabase`) can read it off the context without
 * importing the core-dependent auth entry — they default their principal/tenant
 * binding off this key.
 */
export const PRINCIPAL_KEY = 'principal'

/** Does the principal hold ANY of the given roles? Null-safe (public ⇒ false). */
export function hasRole(p: Principal | undefined, ...roles: string[]): boolean {
  return !!p?.roles && roles.some(r => p.roles!.includes(r))
}

/** Does the principal hold ANY of the given permissions? Null-safe. */
export function hasPermission(p: Principal | undefined, ...permissions: string[]): boolean {
  return !!p?.permissions && permissions.some(x => p.permissions!.includes(x))
}
