import {sentry} from '@hono/sentry'
import {Hono, MiddlewareHandler} from 'hono'
import {except} from 'hono/combine'
import {compress} from 'hono/compress'
import {HTTPException} from 'hono/http-exception'
import {logger} from 'hono/logger'
import type {ContentfulStatusCode} from 'hono/utils/http-status'
import {asyncContext, Env} from '../context'
import type {PylonConfig} from '../index'

type ResolverMap = Record<string, (...args: any[]) => any>

/** A GraphQL resolver fragment — the typed surface the compiler introspects. */
export interface Resolvers {
  Query?: ResolverMap
  Mutation?: ResolverMap
  Subscription?: ResolverMap
}

type GraphqlOf<P> = P extends Pylon<infer G> ? G : {}

/**
 * Deep intersection of every child Pylon's `graphql` fragment. `{Query: A} &
 * {Query: B}` collapses to `{Query: A & B}`, so the per-kind resolver maps merge
 * at the type level — the SAME shape `compose()` proves type-introspects.
 */
type MergeGraphql<C extends readonly unknown[]> = C extends readonly [
  infer H,
  ...infer T
]
  ? GraphqlOf<H> & MergeGraphql<T>
  : {}

const GRAPHQL_KINDS = ['Query', 'Mutation', 'Subscription'] as const

function mergeFragment(into: Resolvers, from: Resolvers | undefined) {
  if (!from) return
  for (const kind of GRAPHQL_KINDS) {
    const map = from[kind]
    if (!map) continue
    into[kind] = {...into[kind], ...map}
  }
}

/**
 * An app's CAPABILITY gate — a check that THROWS on deny (e.g. `ForbiddenError`).
 * A plain thunk, so core stays authz-free: the user (or the pylon-db `gate()`
 * sugar) writes it with auth/db helpers, and core only CALLS it — before every
 * resolver of the app. It runs once the per-request context is bound (after
 * `useDatabase`), so `authorize`/`requireFeature` can read the Principal/features.
 * Row/resource authz is a separate, ORM-layer concern (`defineAbilities`).
 */
export type Gate = () => void | Promise<void>

/** Wrap every resolver so the gate runs (and may throw) before it. Type-transparent. */
function gateResolvers<R extends Resolvers>(resolvers: R, gate: Gate): R {
  const out: Record<string, Record<string, (...a: any[]) => any>> = {}
  for (const kind of GRAPHQL_KINDS) {
    const map = resolvers[kind]
    if (!map) continue
    const wrapped: Record<string, (...a: any[]) => any> = {}
    for (const key of Object.keys(map)) {
      const fn = map[key]
      wrapped[key] = async (...args: any[]) => {
        await gate()
        return fn(...args)
      }
    }
    out[kind] = wrapped
  }
  return out as unknown as R
}

/**
 * The Pylon application — a `Hono` subclass that is the composition primitive of the
 * framework (routes + a GraphQL fragment + a plugin set + a boot lifecycle). It is
 * INSTANTIABLE (`new Pylon()`) rather than a hidden singleton, so apps can be composed
 * fractally: an app is a smaller Pylon; the root is an app of apps.
 *
 * Per-instance state (`config`, `pluginsMiddleware`) lives on the instance so multiple
 * Pylons don't share global mutable state. The default export `app` is one instance,
 * kept for back-compat — the generated entry + every existing plugin target it today.
 */
export class Pylon<G extends Resolvers = {}> extends Hono<Env> {
  /** The resolved config for this instance (set by `executeConfig`). */
  config?: PylonConfig

  /**
   * This Pylon's GraphQL resolver fragment. Built by `resolvers()` / `compose()`.
   * `export const graphql = app.graphql` is the typed surface the compiler reads
   * to emit the SDL; at runtime the same object provides the resolver functions.
   */
  graphql: G = {} as G

  /** Composed child Pylons (recorded by `compose`, for later route/plugin wiring). */
  readonly children: Pylon<any>[] = []

  /**
   * The plugin middleware chain for THIS instance. `executeConfig` fills it; the
   * onion-chain loader below composes it so a middleware can WRAP `next()` (e.g.
   * `useDatabase` binds the per-request connection/tenant/principal around resolver
   * execution). A middleware that returns without calling `next` short-circuits.
   */
  pluginsMiddleware: MiddlewareHandler[] = []

  /** Whether `installBasePipeline()` has already run on this instance (idempotency). */
  private basePipelineInstalled = false

  /**
   * The base-pipeline middleware handlers, tracked so `compose()` can keep them
   * from being copied into a parent when THIS instance is itself composed (the
   * nested-`compose` case) — see `stripBasePipeline`.
   */
  private readonly basePipelineHandlers = new Set<MiddlewareHandler>()

  /**
   * Fuse child apps into this root: each child's `graphql` fragment merges into
   * this Pylon's `graphql` (type-accumulating, the deep intersection — so the
   * build type-introspects ONE merged schema served at one /graphql), and each
   * child's ROUTES are mounted onto this app. Returns the same instance re-typed
   * with the merged graphql.
   *
   * GraphQL doesn't federate — it merges; routes DO mount (Hono sub-app). This is
   * the single composition primitive: `new Pylon().compose(billing, catalog)`.
   *
   * A child mounts at its `basePath` (default `/`), so an app's routes can be
   * namespaced under a prefix (`new Pylon({basePath: '/vault'})` → its routes live
   * under `/vault`). The GraphQL fragment still merges to the single root `/graphql`
   * regardless — `basePath` only prefixes the child's Hono routes. The prefix is
   * also the seam for per-app route middleware (e.g. gating `/vault/*`).
   */
  compose<C extends readonly Pylon<any>[]>(
    ...children: C
  ): Pylon<G & MergeGraphql<C>> {
    // Composing makes THIS instance a served root → it owns the once-per-request
    // base pipeline. Install it BEFORE mounting any child so it precedes the child
    // routes in Hono's registration order (middleware must be registered before the
    // routes it wraps).
    this.installBasePipeline()
    for (const child of children) {
      this.children.push(child)
      mergeFragment(this.graphql, child.graphql)
      // Drop the child's OWN base pipeline (if it was itself a composed sub-root) so
      // it isn't copied into this root and run twice — Hono's `route()` copies from
      // `child.routes`. A leaf child never installed one, so this is a no-op for it.
      child.stripBasePipeline()
      this.route(child.routePrefix ?? '/', child) // mount the child's routes (prefixed)
    }
    return this as unknown as Pylon<G & MergeGraphql<C>>
  }

  /**
   * `new Pylon({ graphql: { Query: {...} } })` declares the resolver fragment up
   * front (the generic `G` is inferred from it), so a leaf app needs no `.resolvers()`
   * chaining. `new Pylon()` is `Pylon<{}>`.
   *
   * Overloads matter: making `graphql` REQUIRED in the second signature forces the
   * checker to infer `G` from the argument. A single `(opts?: {graphql?: G})` lets
   * the build's compiler fall back to the default `G = {}` (an optional property +
   * a defaulted type param is a known inference weak spot) — which silently drops
   * the schema. (Verified: that fallback produced an empty `graphql` type.)
   */
  /** This app's capability gate (if any) — wraps its resolvers. */
  readonly gate?: Gate

  /**
   * Where `compose` mounts THIS app's routes on its parent (default `/`). A
   * composition concern — it prefixes the child's Hono routes only; the GraphQL
   * fragment always merges to the parent's single root `/graphql`.
   */
  readonly routePrefix?: string

  constructor()
  constructor(opts: {graphql: G; gate?: Gate; basePath?: string})
  constructor(opts?: {graphql?: G; gate?: Gate; basePath?: string}) {
    super()

    this.gate = opts?.gate
    this.routePrefix = opts?.basePath

    if (opts?.graphql) {
      // The gate wraps the app's resolvers (capability check before each op),
      // type-transparently — the compiler still introspects the original types.
      const fragment = this.gate
        ? gateResolvers(opts.graphql, this.gate)
        : opts.graphql
      mergeFragment(this.graphql, fragment)
    }

    // NB: the base request pipeline (compress / sentry / async-context / logger /
    // plugin chain / error mapping) is intentionally NOT installed in the
    // constructor. It's a per-served-ROOT concern, installed once by
    // `installBasePipeline()` (from `compose()` and from the serve path). See that
    // method for why constructor args can't decide root-vs-child.
  }

  /**
   * Install the served root's once-per-request middleware: compress, sentry, the
   * async-context bind, the request logger, the plugin chain (binds the per-request
   * DB/tenant/principal), and HTTP error mapping for plain routes.
   *
   * This is a ROOT concern: it must run ONCE per request, not once per app. Hono's
   * `route()` mounts a child by copying its `routes` into the parent, so if every
   * `new Pylon()` installed the pipeline in its constructor, an N-app root would run
   * N× compress/sentry/logger on every request (the duplicated `<-- GET /login`
   * log lines). **Role, not constructor args, decides** — a single-app root is
   * `new Pylon({graphql})` (has args, still served, still needs the pipeline); a
   * child passed into `compose()` never needs it (it inherits the root's pipeline,
   * and `executeConfig`/`handler` target the root). So the pipeline is installed on
   * whoever is composed-onto or served, never on a mere fragment.
   *
   * Idempotent. `compose()` calls it before mounting children (so it precedes their
   * routes in Hono's order); the serve path (`executeConfig`) calls it too, covering
   * a root that is served without composing.
   */
  installBasePipeline() {
    if (this.basePipelineInstalled) return
    this.basePipelineInstalled = true

    // Register through `base()` so each handler is tracked and can be stripped if
    // this instance is later composed into another root (nested `compose`).
    const base = (mw: MiddlewareHandler) => {
      this.basePipelineHandlers.add(mw)
      this.use('*', mw)
    }

    base(compress())
    base(sentry())

    base(async (c, next) => {
      return new Promise((resolve, reject) => {
        asyncContext.run(c, async () => {
          try {
            resolve(await next())
          } catch (error) {
            reject(error)
          }
        })
      })
    })

    base(except(['/__pylon/*'], logger()))

    base((c, next) => {
      const dispatch = (i: number): Promise<void> => {
        const middleware = this.pluginsMiddleware[i]
        if (!middleware) return Promise.resolve(next())
        return Promise.resolve(
          middleware(c, () => dispatch(i + 1))
        ) as Promise<void>
      }
      return dispatch(0)
    })

    // Map a thrown error's HTTP status for PLAIN routes. Auth-free by design: it
    // only reads a numeric `statusCode` convention (pylon-db's ForbiddenError /
    // FeatureDisabledError set 403, NotFoundError 404), so a route guard can just
    // `await gate()` / `requireFeature()` and throw — and get a 403 instead of a
    // bare 500. GraphQL errors never reach here (Yoga maps them in the handler);
    // this is for the Hono routes apps mount (e.g. file serving, webhooks).
    // (`onError` is app-level, not a route, so Hono's `route()` never copies it —
    // only the `use()` middleware above can duplicate, hence only those are tracked.)
    this.onError((err, c) => {
      if (err instanceof HTTPException) return err.getResponse() // honor Hono's own
      const status = (err as {statusCode?: unknown}).statusCode
      if (typeof status === 'number') {
        return c.json({error: err.message}, status as ContentfulStatusCode)
      }
      return c.json({error: 'Internal Server Error'}, 500)
    })
  }

  /**
   * Remove this instance's base-pipeline middleware from the `routes` Hono copies
   * on `compose()`. Used when a composed sub-root (`root.compose(sub)` where
   * `sub = new Pylon().compose(leaf)`) would otherwise duplicate its pipeline into
   * its parent. A leaf child never installed one, so this is a no-op for it.
   */
  private stripBasePipeline() {
    if (!this.basePipelineInstalled) return
    this.routes = this.routes.filter(
      r => !this.basePipelineHandlers.has(r.handler as MiddlewareHandler)
    )
    this.basePipelineInstalled = false
    this.basePipelineHandlers.clear()
  }
}

export const app = new Pylon()

/**
 * Back-compat alias for the default instance's plugin middleware array. Existing
 * imports of `pluginsMiddleware` keep working (it's the same array `app` composes).
 */
export const pluginsMiddleware = app.pluginsMiddleware
