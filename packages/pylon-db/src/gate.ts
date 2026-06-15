/**
 * `gate({authorize, feature})` — sugar that builds a Pylon capability `Gate` (the
 * thunk the core `Pylon` constructor wraps an app's resolvers with). It composes
 * the two capability-tier checks against the bound request context:
 *   - `authorize` — a Principal predicate; throws `ForbiddenError` on false,
 *   - `feature`   — a feature flag; throws `FeatureDisabledError` if not enabled.
 *
 * Lives in pylon-db because `feature` reads the per-tenant feature state from the
 * ORM context (and the Principal from the same context) — no dependency on the
 * core-bound auth entry, so pylon-db stays CLI-standalone. Row/resource authz is
 * the separate `defineAbilities` mechanism.
 *
 *   new Pylon({ graphql, gate: gate({authorize: p => hasRole(p, 'shop')}) })
 */
import type {Gate} from '@getcronit/pylon'
import type {Principal} from '@getcronit/pylon-auth/contract'
import {currentPrincipal} from './app-context.js'
import {ForbiddenError, requireFeature} from './features.js'

export interface GateOptions {
  /** Capability predicate over the bound Principal. Throws `ForbiddenError` on false. */
  authorize?: (principal: Principal | undefined) => boolean
  /** Feature flag that must be enabled for the tenant. Throws `FeatureDisabledError`. */
  feature?: string
}

export function gate(opts: GateOptions): Gate {
  return () => {
    if (
      opts.authorize &&
      !opts.authorize(currentPrincipal() as Principal | undefined)
    ) {
      throw new ForbiddenError()
    }
    if (opts.feature) requireFeature(opts.feature)
  }
}
