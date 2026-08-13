/**
 * Feature gating — per-tenant entitlements. Orthogonal to BOTH tenancy ("whose
 * data?") and authz ("who may?"): features answer "is this capability part of the
 * tenant's plan?". A feature is a boolean switch OR carries a VALUE (a limit like
 * `seats: 5`, or a variant like `checkout: 'v2'`).
 *
 * The state is RESOLVED ONCE per request/job by a `FeatureProvider` (the seam:
 * back it with a static plan map, a DB table, or LaunchDarkly/OpenFeature) and
 * bound on the ambient app context; the helpers here read it synchronously.
 * Distinct from authz: a disabled feature is `FEATURE_DISABLED` ("upgrade your
 * plan"), NOT `FORBIDDEN` ("not allowed") — so the UI can branch differently.
 */
import {
  currentFeatureState,
  type AppContext,
  type FeatureState,
  type FeatureValue
} from './app-context.js'

// The canonical authz error (re-exported for back-compat). Feature denial is its
// OWN error below — not a ForbiddenError.
export {ForbiddenError} from '@getcronit/pylon-auth/contract'

/** Thrown when a required feature isn't in the tenant's plan. → `FEATURE_DISABLED`. */
export class FeatureDisabledError extends Error {
  readonly code = 'FEATURE_DISABLED'
  readonly statusCode = 403
  constructor(
    message: string,
    /** The feature that was required (surfaced in the GraphQL error extensions). */
    readonly feature?: string
  ) {
    super(message)
    this.name = 'FeatureDisabledError'
  }
}

/**
 * Resolves a tenant's feature state for a request/job. THE seam — swap the source
 * (static plan, DB, LaunchDarkly) without touching enforcement. Runs once at bind
 * time (may be async); the helpers then read the bound state synchronously.
 */
export type FeatureProvider<Ctx = unknown> = (
  context: Ctx
) => FeatureState | readonly string[] | undefined | Promise<FeatureState | readonly string[] | undefined>

/** A typed feature registry: `defineFeatures(['products','invoicing'] as const)`. */
export function defineFeatures<const T extends readonly string[]>(
  features: T
): {readonly [K in T[number]]: K} {
  return Object.fromEntries(features.map(f => [f, f])) as {readonly [K in T[number]]: K}
}

/** Is `feature` enabled (truthy) for the current tenant? */
export function isFeatureEnabled(feature: string): boolean {
  return !!currentFeatureState()[feature]
}

/** The value of `feature` (limit/variant) for the current tenant, or `fallback`. */
export function featureValue<T extends FeatureValue>(feature: string, fallback: T): T {
  const v = currentFeatureState()[feature]
  return (v === undefined ? fallback : v) as T
}

/** Throw `FeatureDisabledError` unless `feature` is enabled for the current tenant. */
export function requireFeature(feature: string): void {
  if (!isFeatureEnabled(feature)) {
    throw new FeatureDisabledError(`Feature "${feature}" is not enabled for this tenant.`, feature)
  }
}

/**
 * A ready resolver exposing the current tenant's feature state to the FRONTEND —
 * so the UI can hide/disable features instead of hitting server errors. Add it to
 * your schema: `Query: { features: featuresResolver }`. Returns the flag→value map.
 */
export function featuresResolver(): FeatureState {
  return currentFeatureState()
}

/**
 * Wrap every resolver in a fragment so it checks `feature` before running. Returns
 * the SAME shape/type (identity for the type-introspection build), so it's applied
 * at the host's compose site: `...products.gate(productResolvers)`.
 */
export function gateResolvers<R extends Record<string, (...args: any[]) => any>>(
  feature: string,
  resolvers: R
): R {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(resolvers)) {
    const fn = resolvers[key]
    out[key] = (...args: any[]) => {
      requireFeature(feature)
      return fn(...args)
    }
  }
  return out as R
}

// Re-export the context-bound types for `FeatureProvider` consumers.
export type {AppContext, FeatureState, FeatureValue}
