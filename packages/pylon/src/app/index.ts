import {Hono, MiddlewareHandler} from 'hono'
import {except} from 'hono/combine'
import {compress} from 'hono/compress'
import {HTTPException} from 'hono/http-exception'
import type {ContentfulStatusCode} from 'hono/utils/http-status'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {asyncContext, Env} from '../core/context'
import {accessLogEnabled, getLogger, getRootLogger, runWithLogger} from '../core/logger'
import type {PylonConfig} from '../core/index'

/** A per-request correlation id: an inbound `x-request-id`, the trace-id of a W3C `traceparent`,
 *  else a fresh UUID. Web Crypto is available on Node 19+, Bun, Deno and workerd. */
function requestId(c: {req: {header(name: string): string | undefined}}): string {
  return (
    c.req.header('x-request-id') ??
    c.req.header('traceparent')?.split('-')[1] ??
    newId()
  )
}
function newId(): string {
  const g = globalThis as {crypto?: {randomUUID?: () => string}}
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

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

/**
 * Constructor options for a `Pylon`. Named + AUGMENTABLE on purpose: satellite
 * packages add their own app-level config keys via `declare module` (e.g. pylon-db
 * adds `models?: {...}`), so an app's whole configuration lives in one
 * `new Pylon({...})` call — without core knowing what those keys mean. Core stashes
 * the object on `app.pylonOptions`; each satellite reads its own slice from there.
 */
export interface PylonOptions<G extends Resolvers = {}> {
  graphql?: G
  gate?: Gate
  basePath?: string
  name?: string
}

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
/**
 * Absolute directory of the source file that CALLED `new Pylon()` — the first stack
 * frame outside the constructor. Reads real frames, so it needs the constructing file
 * to run unbundled (the project runner guarantees this; the legacy bundle loader would
 * report the bundle temp file). Returns undefined if capture is unsupported.
 */
function callerSourceDir(): string | undefined {
  const prep = Error.prepareStackTrace
  try {
    Error.prepareStackTrace = (_, frames) => frames as unknown as string
    const holder: {stack?: unknown} = {}
    Error.captureStackTrace(holder, Pylon) // drop frames at/above the Pylon constructor
    const frames = (holder.stack ?? []) as Array<{getFileName(): string | null | undefined}>
    for (const f of frames) {
      const file = f.getFileName()
      if (!file || file.startsWith('node:')) continue
      return path.dirname(file.startsWith('file:') ? fileURLToPath(file) : file)
    }
  } catch {
    /* capture unsupported → undefined; explicit `db.migrations` still works */
  } finally {
    Error.prepareStackTrace = prep
  }
  return undefined
}

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

  /** Whether `realize()` has mounted this instance's composed child tree (idempotency). */
  private realized = false

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
   * RECORD-only: `compose` merges the graphql fragment and records each child, but
   * does NOT mount routes or install any middleware. The child tree is mounted once,
   * at boot, by `realize()` — after `installBasePipeline()` — so the once-per-request
   * pipeline precedes the routes and is never duplicated (no "install on the composer,
   * strip when re-composed" dance). A child mounts at its `basePath` (default `/`), so
   * an app's routes can be namespaced under a prefix (`new Pylon({basePath: '/vault'})`
   * → its routes live under `/vault`); the GraphQL fragment still merges to the single
   * root `/graphql`. The prefix is the seam for per-app route middleware (gating `/vault/*`).
   */
  compose<C extends readonly Pylon<any>[]>(
    ...children: C
  ): Pylon<G & MergeGraphql<C>> {
    for (const child of children) {
      this.children.push(child)
      mergeFragment(this.graphql, child.graphql)
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
  /**
   * A stable identity for this app. Generic and auth/db-free — core only stores it.
   * Satellites use it as the app's key: `pylon-db` groups this app's migrations under
   * it when models bind via `app.model()`, and `pylon-queues` namespaces `app.queue()`.
   * Optional; composition never requires it.
   */
  readonly name?: string

  /**
   * The raw constructor options, including satellite-augmented keys (e.g. pylon-db's
   * `models`). Core never interprets the extra keys — satellites read their own slice
   * (`app.pylonOptions.models`) so app config can live in one `new Pylon({...})` call.
   */
  readonly pylonOptions: PylonOptions<G>

  /** This app's capability gate (if any) — wraps its resolvers. */
  readonly gate?: Gate

  /**
   * Where `compose` mounts THIS app's routes on its parent (default `/`). A
   * composition concern — it prefixes the child's Hono routes only; the GraphQL
   * fragment always merges to the parent's single root `/graphql`.
   */
  readonly routePrefix?: string

  /**
   * Absolute directory of the SOURCE FILE that constructed this Pylon (captured from
   * the call stack). Generic and satellite-free — core only stores it. Satellites use
   * it to colocate per-app artifacts with the app's source: `pylon-db` defaults an
   * app's migrations to `<sourceDir>/migrations`. `undefined` if the call site can't
   * be determined. Requires the constructing file to run as itself (not bundled) —
   * which the project runner guarantees.
   */
  readonly sourceDir?: string

  constructor()
  // `{graphql: G}` leads (graphql REQUIRED) so the checker still infers `G` from the
  // argument — an optional `graphql?` here silently dropped the schema. `& PylonOptions`
  // adds the rest, including any satellite-augmented keys (e.g. pylon-db's `models`).
  constructor(opts: {graphql: G} & PylonOptions<G>)
  // A graphql-less app (routes/models/queues only) — `Pylon<{}>`.
  constructor(opts: PylonOptions<G>)
  constructor(opts?: PylonOptions<G>) {
    super()

    this.sourceDir = callerSourceDir()
    this.pylonOptions = opts ?? {}
    this.name = opts?.name
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

    // Let satellites process construction-time options (e.g. the `models` / `queues`
    // class lists added by pylon-db / pylon-queues) via the extension bus, now that
    // `pylonOptions`/`name` are set. Keeps core decoupled — it never reads those keys.
    const bus = (globalThis as Record<symbol, any>)[Symbol.for('@getcronit/pylon.extend')]
    if (bus?.constructHooks) for (const hook of bus.constructHooks) hook(this)

    // NB: the base request pipeline (compress / async-context / logger /
    // plugin chain / error mapping) is intentionally NOT installed in the
    // constructor. It's a per-served-ROOT concern, installed once by
    // `installBasePipeline()` (from `compose()` and from the serve path). See that
    // method for why constructor args can't decide root-vs-child.
  }

  /**
   * Install the served root's once-per-request middleware: compress, the
   * async-context bind, the request logger, the plugin chain (binds the per-request
   * DB/tenant/principal), and HTTP error mapping for plain routes.
   *
   * A ROOT concern, installed ONCE by `executeConfig` (boot) — BEFORE `realize()`
   * mounts the child tree, so the middleware precedes the routes in Hono's order.
   * Children are never given a pipeline (they're only mounted by `realize`), so
   * there's nothing to duplicate and nothing to strip. Idempotent (boot runs it for
   * both the 'first' and 'last' plugin passes).
   */
  installBasePipeline() {
    if (this.basePipelineInstalled) return
    this.basePipelineInstalled = true

    this.use('*', compress())

    this.use('*', async (c, next) => {
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

    // Structured request logger (rfcs/RUNTIME_LOGGER.md). Replaces hono/logger: bind a request
    // child (correlated by a generated id, `http`-tagged) into the logger scope so `getLogger()`
    // is correlated in every downstream plugin/resolver/route, then emit one structured access
    // line. Skips /__pylon/* (static assets) and the whole line when `config.logger: false`.
    this.use(
      '*',
      except(['/__pylon/*'], (c, next) => {
        const start = Date.now()
        const reqLog = getRootLogger()
          .child({
            requestId: requestId(c),
            method: c.req.method,
            path: c.req.path
          })
          .withTag('http')
        return runWithLogger(reqLog, async () => {
          await next()
          if (accessLogEnabled()) {
            reqLog.info('request', {status: c.res.status, durationMs: Date.now() - start})
          }
        })
      })
    )

    this.use('*', (c, next) => {
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
    this.onError((err, c) => {
      if (err instanceof HTTPException) return err.getResponse() // honor Hono's own
      const status = (err as {statusCode?: unknown}).statusCode
      if (typeof status === 'number') {
        return c.json({error: err.message}, status as ContentfulStatusCode)
      }
      // Unexpected error (no `statusCode` convention) → log the real cause (structured +
      // request-correlated) so it isn't swallowed into a bare 500. Expected denials (403/404
      // above) stay quiet.
      getLogger().error('unhandled route error', {err})
      return c.json({error: 'Internal Server Error'}, 500)
    })
  }

  /**
   * Mount this instance's composed child tree (recorded by `compose`) onto its Hono
   * routes. Depth-first — a child realizes its OWN children before being mounted, so
   * a nested compose (`root.compose(sub)`, `sub = new Pylon().compose(leaf)`) mounts
   * the whole tree. Each child mounts at its `basePath` (default `/`). Idempotent.
   *
   * Called once by boot (`executeConfig`) AFTER `installBasePipeline`, so the
   * base-pipeline middleware is registered before any route it must wrap. Children
   * never install a pipeline (only `realize` touches them), so mounting them can't
   * duplicate it.
   */
  realize() {
    if (this.realized) return
    this.realized = true
    for (const child of this.children) {
      child.realize()
      this.route(child.routePrefix ?? '/', child)
    }
  }
}

/**
 * Generic, content-agnostic extension point. Satellite packages (pylon-db,
 * pylon-queues) add instance methods like `app.model()` / `app.queue()` by patching
 * `Pylon.prototype` — but they must NOT import core (it would pull core's web-runtime
 * closure into e.g. the migration CLI and make the optional `@getcronit/pylon` peer
 * effectively required). So they register a patcher on a shared global; core applies
 * it here once `Pylon` exists. A satellite loaded LATER sees `bus.Pylon` set and
 * applies itself immediately. Core never learns what the patchers do.
 */
{
  const EXT = Symbol.for('@getcronit/pylon.extend')
  const bus = ((globalThis as any)[EXT] ??= {
    fns: [] as Array<(P: typeof Pylon) => void>,
    // Per-construction hooks: a satellite pushes one to process its slice of the
    // constructor options (e.g. the `models`/`queues` lists). Run by every `new Pylon`.
    constructHooks: [] as Array<(app: Pylon<any>) => void>,
    Pylon: undefined as typeof Pylon | undefined
  })
  bus.constructHooks ??= [] // a satellite may have created the bus without this field
  bus.Pylon = Pylon
  for (const patch of bus.fns.splice(0)) patch(Pylon)
}

export const app = new Pylon()

/**
 * Back-compat alias for the default instance's plugin middleware array. Existing
 * imports of `pluginsMiddleware` keep working (it's the same array `app` composes).
 */
export const pluginsMiddleware = app.pluginsMiddleware
