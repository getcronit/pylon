/**
 * The canonical actor for a request. Produced by an IDENTITY PROVIDER (any auth
 * mechanism) and carried in the Context; everything downstream — ORM policies,
 * abilities, gates — authorizes against it. A plain, serializable data shape, so
 * helpers are free functions (the principal can cross the ALS and be logged).
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
 * Swapping providers never touches a policy, model, or resolver.
 */
export type IdentityProvider<Ctx = unknown> = (
  context: Ctx
) => Principal | undefined | Promise<Principal | undefined>

/** Does the principal hold ANY of the given roles? Null-safe (public ⇒ false). */
export function hasRole(p: Principal | undefined, ...roles: string[]): boolean {
  return !!p?.roles && roles.some(r => p.roles!.includes(r))
}

/** Does the principal hold ANY of the given permissions? Null-safe. */
export function hasPermission(p: Principal | undefined, ...permissions: string[]): boolean {
  return !!p?.permissions && permissions.some(x => p.permissions!.includes(x))
}
