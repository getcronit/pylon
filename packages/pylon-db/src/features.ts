/**
 * Feature flags — typed, per-tenant capability gating. Orthogonal to tenancy:
 * tenancy answers "whose data?", features answer "is this domain enabled for this
 * tenant?". The enabled set is read from the ambient app context (populated by
 * `useDatabase({features})` per request / the queue runtime per job).
 */
import {currentFeatures} from './app-context.js'

/** Thrown when a required feature isn't enabled. Mapped to a FORBIDDEN GraphQL error. */
export class ForbiddenError extends Error {
  constructor(
    message: string,
    readonly feature?: string
  ) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

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
