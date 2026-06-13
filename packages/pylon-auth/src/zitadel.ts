/**
 * @getcronit/pylon-auth/zitadel — a Zitadel/OIDC identity provider.
 *
 * Bridges the seam: core's `useAuth` plugin authenticates the request and puts
 * an OIDC `AuthState` on the context (`c.get('auth')`); `zitadelAuth()` maps that
 * to a `Principal` so `useApp({identity: zitadelAuth()})` (or any `useIdentity`)
 * can drive every authz tier from it. Swapping to a custom JWT provider means
 * swapping this one function — no gate, policy, model, or resolver changes.
 *
 * Dependency-free: it reads the `AuthState` STRUCTURALLY (no `openid-client`, no
 * core runtime import), so opting into Zitadel doesn't pull heavy deps onto the
 * light auth path. (The OIDC machinery itself lives in core's `useAuth` today.)
 */
import type {IdentityProvider, Principal} from './principal.js'

/** The minimal shape of the OIDC user that core's `useAuth` sets on the context. */
export interface OidcUser {
  /** OIDC subject — the stable user id. */
  sub?: string
  /** Roles projected by `useAuth` (Zitadel role claim → string[]). */
  roles?: string[]
  /** Remaining standard/custom OIDC claims. */
  [claim: string]: unknown
}

interface AuthStateLike {
  user?: OidcUser
}

/** A context that exposes the request's auth state (Hono `Context`, structurally). */
interface ContextLike {
  get(key: 'auth'): AuthStateLike | undefined
  get(key: string): unknown
}

export interface ZitadelAuthOptions {
  /** Derive the tenant id (e.g. organization) from the claims. Default: none. */
  tenant?: (user: OidcUser) => string | number | undefined
  /** Override the principal id (default: the OIDC `sub`). */
  id?: (user: OidcUser) => string | number
  /** Fine-grained permissions, if your claims carry them (default: none). */
  permissions?: (user: OidcUser) => readonly string[]
  /** Attributes for ABAC rules (default: all claims). */
  attributes?: (user: OidcUser) => Record<string, unknown>
}

/**
 * An `IdentityProvider` that turns core `useAuth`'s OIDC `AuthState` into a
 * `Principal`. Returns `undefined` for unauthenticated requests (public access).
 */
export function zitadelAuth(options: ZitadelAuthOptions = {}): IdentityProvider<ContextLike> {
  return context => {
    const user = context.get('auth')?.user
    if (!user) return undefined
    const principal: Principal = {
      id: options.id?.(user) ?? user.sub ?? '',
      tenant: options.tenant?.(user),
      roles: user.roles ?? [],
      permissions: options.permissions?.(user) ?? [],
      attributes: options.attributes?.(user) ?? user
    }
    return principal
  }
}
