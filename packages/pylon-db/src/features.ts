/**
 * Feature flags — typed, per-tenant capability gating. Orthogonal to tenancy:
 * tenancy answers "whose data?", features answer "is this domain enabled for this
 * tenant?". The enabled set is read from the ambient app context (populated by
 * `useDatabase({features})` per request / the queue runtime per job).
 */
import {currentFeatures} from './app-context.js'

// The canonical authz error lives in pylon-auth (row authz / feature gating IS
// authz, so the ORM depends on the auth contract). Imported from the
// zero-dependency `/contract` entry, so this stays free of the web framework.
// Re-exported for back-compat: existing `import {ForbiddenError} from './features.js'`
// callers keep working, now against the single shared class.
export {ForbiddenError} from '@getcronit/pylon-auth/contract'
import {ForbiddenError} from '@getcronit/pylon-auth/contract'

/** A typed feature registry: `defineFeatures(['products','invoicing'] as const)`. */
export function defineFeatures<const T extends readonly string[]>(
  features: T
): {readonly [K in T[number]]: K} {
  return Object.fromEntries(features.map(f => [f, f])) as {readonly [K in T[number]]: K}
}

/** Throw `ForbiddenError` unless `feature` is enabled for the current tenant. */
export function requireFeature(feature: string): void {
  if (!currentFeatures().includes(feature)) {
    throw new ForbiddenError(`Feature "${feature}" is not enabled for this tenant.`, feature)
  }
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
