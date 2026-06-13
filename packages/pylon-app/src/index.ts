/**
 * @getcronit/pylon-app — the batteries-included BACKEND for Pylon.
 *
 * The modular "app" system (definePylonApp / compose / useApp) + auth & authz,
 * layered on the ORM. A Pylon **App** is a bounded context that owns three
 * surfaces — ORM models, a GraphQL resolver fragment, and Hono routes — under one
 * authz boundary, all running inside one request Context.
 *
 * This package RE-EXPORTS @getcronit/pylon-db, so app authors have a single
 * import for models, policies, AND the app/authz surface. The ORM stays usable
 * standalone — the migration CLI and headless scripts import pylon-db directly,
 * without the app runtime.
 *
 * Layering: pylon-ir → pylon-db → pylon-app → (peer) pylon core. Core stays clean
 * (GraphQL-from-types only); `usePages` is the frontend battery, `useApp` is this
 * backend battery.
 */
export * from '@getcronit/pylon-db'

// Capability-tier authz + the Principal contract come from pylon-auth. There is
// ONE `ForbiddenError` (pylon-db re-exports pylon-auth's from /contract), so the
// authz API, the ORM's row/feature denials, and the public error are the same
// class — this explicit re-export and pylon-db's star-export resolve to it.
// Capability-tier authz from pylon-auth — EXCEPT `authorize`, which pylon-app
// re-defines as an overload spanning both tiers (capability predicate OR resource
// form), delegating the predicate form back to pylon-auth.
export {
  type Principal,
  type IdentityProvider,
  hasRole,
  hasPermission,
  getPrincipal,
  requireRole,
  useIdentity,
  ForbiddenError
} from '@getcronit/pylon-auth'

// Resource-tier authz (extends `authorize` with the resource form).
export {
  defineAbilities,
  authorize,
  can,
  cannot,
  filter,
  type AbilitiesFn,
  type AbilityRule
} from './abilities.js'
export {matchWhere, AbilityMatchError} from './matcher.js'

export {
  defineApp,
  type App,
  type AppConfig,
  type Resolvers,
  type RouteRegistrar
} from './app.js'

export {compose, type Composed} from './compose.js'
export {useApp, type UseAppOptions} from './use-app.js'
