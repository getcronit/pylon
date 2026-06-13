/**
 * `defineApp` — a Pylon **App**: a bounded context owning three surfaces (ORM
 * models, a GraphQL resolver fragment, Hono routes) under one authz boundary.
 *
 * It wraps `models.app(name, …)` (so models/migrations/tenant/secure/policy work
 * exactly as in the ORM) and adds ownership of `.resolvers()` and `.routes()`,
 * plus the app-level authz config (`feature`, `authorize`). `compose()` + `useApp`
 * (next increment) merge each app's resolvers into one typed schema, mount its
 * routes, and apply its gate — all inside one request Context.
 *
 * The App is an immutable builder: `.resolvers()`/`.routes()` return a new App
 * that ACCUMULATES into the type, so `compose(app1, app2)` can infer the merged
 * GraphQL shape (the build generates SDL by type-introspecting it).
 */
import {models, type AppPolicy} from '@getcronit/pylon-db'
import type {Principal} from '@getcronit/pylon-auth'

type ResolverMap = Record<string, (...args: any[]) => any>

/** A GraphQL resolver fragment owned by an app. */
export interface Resolvers {
  Query?: ResolverMap
  Mutation?: ResolverMap
  Subscription?: ResolverMap
}

/** A function that registers an app's REST routes on the host router (Hono). */
export type RouteRegistrar = (router: any) => void

export interface AppConfig {
  /** Tenant property to auto-scope this app's models by (e.g. `organizationId`). */
  tenant?: string
  /** Deny-by-default authorization for this app's models. */
  secure?: boolean
  /** App-wide default row policy (see `definePolicy`). */
  policy?: AppPolicy
  /** Explicit migration-group dependencies (on top of inferred cross-app FKs). */
  dependsOn?: string[]
  /** Tenant feature this whole app is gated behind (its ops + routes). */
  feature?: string
  /** App-level operation gate: every op/route requires this of the principal. */
  authorize?: (principal: Principal | undefined) => boolean
}

type OrmBuilders = ReturnType<typeof models.app>

/** A Pylon App carrying its accumulated resolver type `R`. */
export type App<R extends Resolvers = {}> = OrmBuilders & {
  /** The app/migration-group name. */
  readonly name: string
  readonly config: AppConfig
  /** Register this app's GraphQL resolvers; returns a new App with `R2` folded in. */
  resolvers<R2 extends Resolvers>(r: R2): App<R & R2>
  /** Register this app's REST routes (mounted by `useApp`, inside the Context). */
  routes(register: RouteRegistrar): App<R>
  /** @internal — read by `compose()`. */
  readonly __resolvers: R
  /** @internal — read by `compose()`. */
  readonly __routes: readonly RouteRegistrar[]
}

function mergeResolvers(a: Resolvers, b: Resolvers): Resolvers {
  const out: Resolvers = {}
  for (const k of ['Query', 'Mutation', 'Subscription'] as const) {
    const merged = {...a[k], ...b[k]}
    if (Object.keys(merged).length) out[k] = merged
  }
  return out
}

function makeApp<R extends Resolvers>(
  name: string,
  config: AppConfig,
  orm: OrmBuilders,
  resolvers: R,
  routes: readonly RouteRegistrar[]
): App<R> {
  return {
    ...orm,
    name,
    config,
    resolvers: <R2 extends Resolvers>(r: R2) =>
      makeApp(name, config, orm, mergeResolvers(resolvers, r) as R & R2, routes),
    routes: (register: RouteRegistrar) =>
      makeApp(name, config, orm, resolvers, [...routes, register]),
    __resolvers: resolvers,
    __routes: routes
  } as unknown as App<R>
}

/** Create a Pylon App. Declare models with `@app.model()`, then `.resolvers()` /
 *  `.routes()`; compose apps into a service with `compose()` + `useApp`. */
export function defineApp(name: string, config: AppConfig = {}): App<{}> {
  const orm = models.app(name, {
    tenant: config.tenant,
    secure: config.secure,
    policy: config.policy,
    dependsOn: config.dependsOn,
    feature: config.feature
  })
  return makeApp(name, config, orm, {}, [])
}
