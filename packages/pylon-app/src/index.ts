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

export {
  type Principal,
  type IdentityProvider,
  hasRole,
  hasPermission
} from './principal.js'
