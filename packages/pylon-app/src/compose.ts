/**
 * `compose(...apps)` — fuse N `defineApp` Apps into the two artifacts a Pylon
 * service needs:
 *
 *  - `.graphql` — every app's resolver fragment merged into ONE object whose
 *    TYPE is the deep intersection of the fragments, so `export const graphql =
 *    compose(...).graphql` lets the build type-introspect the whole schema.
 *  - `.apps` — the App list, for `useApp` to mount each app's routes and bind
 *    its Context.
 *
 * Each app's resolvers are GATE-WRAPPED here (at the compose site, so the wrapper
 * preserves the resolver's type identity and the introspected schema is
 * unchanged): every op first runs the app's capability `authorize` check and its
 * `feature` gate, then the resolver. Routes are gated equivalently by `useApp`.
 */
import {requireFeature} from '@getcronit/pylon-db'
import {authorize as capabilityAuthorize} from '@getcronit/pylon-auth'
import type {App, AppConfig, Resolvers} from './app.js'

type ResolverMap = Record<string, (...args: any[]) => any>

type ResolversOf<A> = A extends App<infer R> ? R : {}

/** Deep intersection of every app's resolver fragment (Query/Mutation merge). */
type MergeResolvers<A extends readonly unknown[]> = A extends readonly [
  infer H,
  ...infer T
]
  ? ResolversOf<H> & MergeResolvers<T>
  : {}

/** The result of composing apps: the typed merged schema + the apps themselves. */
export interface Composed<G extends Resolvers> {
  /** Merged, gate-wrapped resolvers — assign to `export const graphql`. */
  readonly graphql: G
  /** The composed apps — consumed by `useApp` (routes + Context binding). */
  readonly apps: readonly App<any>[]
}

/** Wrap each resolver so it enforces the app's gate before running. Type-preserving. */
function applyGate<R extends ResolverMap>(resolvers: R, config: AppConfig): R {
  const {feature, authorize: authz} = config
  if (!feature && !authz) return resolvers
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(resolvers)) {
    const fn = resolvers[key]
    out[key] = (...args: any[]) => {
      if (authz) capabilityAuthorize(authz) // capability gate → ForbiddenError
      if (feature) requireFeature(feature) // feature gate → ForbiddenError
      return fn(...args)
    }
  }
  return out as R
}

export function compose<A extends App<any>[]>(...apps: A): Composed<MergeResolvers<A>> {
  const graphql: Resolvers = {}
  for (const app of apps) {
    for (const kind of ['Query', 'Mutation', 'Subscription'] as const) {
      const map = app.__resolvers[kind]
      if (!map) continue
      graphql[kind] = {...graphql[kind], ...applyGate(map, app.config)}
    }
  }
  return {graphql: graphql as MergeResolvers<A>, apps}
}
