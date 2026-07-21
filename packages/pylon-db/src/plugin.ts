/**
 * `useDatabase()` — the thin RUNTIME integration between the ORM and a Pylon app.
 *
 * The ORM core (models, manager, migrations) is a standalone library — the
 * migration CLI and `pylon build` must stay pure and never run the app, so they
 * use it directly, not through a plugin. What a plugin *is* for is runtime
 * wiring: connect on startup, bind the request's connection, and surface ORM
 * errors to API clients properly.
 *
 * - `setup` connects from config/env (runs before the app serves).
 * - `middleware` binds the request's connection through the `databaseContext`
 *   AsyncLocalStorage (optional `transactionPerRequest` wraps each request in one
 *   transaction — committed on success, rolled back if the handler throws).
 * - `onExecute` maps a thrown `ValidationError` to a client-safe GraphQL error
 *   (`extensions.code = 'BAD_USER_INPUT'` + structured issues) so it ISN'T masked
 *   to "Unexpected error" — clients get the field-level issues to translate.
 *
 * Returns a real Pylon `Plugin` — `@getcronit/pylon` is a TYPE-ONLY import here
 * (an optional peer; erased at runtime), so the conformance is checked at compile
 * time without coupling the ORM core to the framework at runtime. The CLI/build
 * use the rest of pylon-db without ever importing this plugin.
 */
import type {Plugin} from '@getcronit/pylon'
import {GraphQLError} from 'graphql'
import {runWithAppContext} from './app-context.js'
import {connect, type Database, databaseForKysely} from './database.js'
import {BadRequestError, NotFoundError} from './errors.js'
import {setGidNamespace} from './gid.js'
import {leaseNodeId, type NodeLease} from './node-lease.js'
import {setSnowflakeNodeId} from './snowflake.js'
import {ForbiddenError, FeatureDisabledError, type FeatureState} from './features.js'
import {PRINCIPAL_KEY} from '@getcronit/pylon-auth/contract'
import {ValidationError, type ValidationIssue} from './validation.js'

/** Maps a ValidationError's issues to a GraphQL error's message + extensions. */
export type ValidationErrorMapper = (issues: ValidationIssue[]) => {
  message?: string
  extensions?: Record<string, unknown>
}

/** Default: a client-safe `BAD_USER_INPUT` error carrying the structured issues. */
export const defaultValidationErrorMapper: ValidationErrorMapper = issues => ({
  message: 'Validation failed',
  extensions: {code: 'BAD_USER_INPUT', issues}
})

export interface UseDatabaseOptions {
  /** Defaults to `process.env.DATABASE_URL` (else standard `PG*` env vars). */
  connectionString?: string
  /**
   * Snowflake node id (0..1023) for `id({snowflake: true})` primary keys — the
   * per-process identity that keeps ids from different instances from colliding.
   * Give each concurrently-writing replica a DISTINCT value. Configured here, not
   * via env.
   *
   * - a `number` → use it as-is (single instance, or you assign them yourself).
   * - `'lease'` → claim a unique slot from the database at boot and hold it with a
   *   heartbeat (multi-instance / PM2 cluster: collision-free, zero config; a
   *   crashed instance's slot is reclaimed after the TTL).
   * - omitted → `0` (fine for a single writer).
   */
  nodeId?: number | 'lease'
  /**
   * Namespace segment for global ids: `gid://<gidNamespace>/<Type>/<id>`. Defaults
   * to `'pylon'`. Set it to your app/vendor name (Shopify-style) so gids are
   * self-identifying. Applies to both encoding and decoding.
   */
  gidNamespace?: string
  /**
   * Run each request inside a single transaction, bound as the ambient
   * connection — committed when the handler resolves, rolled back if it throws.
   */
  transactionPerRequest?: boolean
  /**
   * How a thrown `ValidationError` surfaces to API clients. Default maps it to a
   * client-safe `BAD_USER_INPUT` GraphQL error with the structured issues. Pass
   * a custom mapper (e.g. to localize from `code`+`params` using the request
   * locale), or `false` to leave it masked.
   */
  validationErrors?: false | ValidationErrorMapper
  /**
   * Current tenant id for the request. Receives the request's Hono context (so it
   * works without relying on `getContext()` ALS timing): `c => c.get('session')?.orgId`.
   * Bound into the ambient app context so tenant-scoped models auto-filter.
   * Null-safe (return undefined for unauthenticated/public requests).
   */
  tenant?: (context: any) => string | number | undefined
  /**
   * The feature provider: resolves the current tenant's feature state once per
   * request (`c => c.get('session')?.features`). Return a `FeatureState` (flag →
   * value/bool) or a bare `string[]` of enabled flags. May be async (DB/LaunchDarkly).
   * Bound into the ambient app context for `requireFeature`/`featureValue`. Null-safe.
   */
  features?: (
    context: any
  ) => FeatureState | readonly string[] | undefined | Promise<FeatureState | readonly string[] | undefined>
  /**
   * The authenticated principal for the request: `c => c.get('session')`. Bound
   * into the ambient app context so row-level policies (`definePolicy`) can
   * authorize. Null-safe (return undefined for public requests).
   */
  principal?: (context: any) => unknown
  /**
   * Verbose ORM tracing: log every SQL query (+ params/duration), the tenant
   * scoping applied per model, and each row-level policy decision (allow / deny /
   * row-filter). Dev diagnostics — leave off in production. `true` traces all
   * requests; pass a predicate to trace selectively (e.g.
   * `c => c.req.header('x-debug') === '1'`).
   */
  debug?: boolean | ((context: any) => boolean)
}

export function useDatabase(options: UseDatabaseOptions = {}): Plugin {
  const mapper =
    options.validationErrors === false
      ? null
      : options.validationErrors ?? defaultValidationErrorMapper

  // The plugin owns its connection — captured from `connect()` in `setup`, used
  // directly in `middleware`. We don't re-fetch it via `getDatabase()`: that
  // accessor's global fallback is for the CLI/migrations/tests that run without a
  // plugin, and bouncing the handle through the module global here would be a
  // needless coupling (and a worse error if `setup` somehow hadn't run).
  let db: Database | undefined
  let nodeLease: NodeLease | undefined

  return {
    name: 'database',
    // Bind the ORM Context AFTER identity (so the principal is on the request).
    // Ignored if no `identity` plugin is present (raw ORM, no auth).
    dependsOn: ['identity'],
    async setup() {
      db = connect({connectionString: options.connectionString ?? process.env.DATABASE_URL})
      // Apply id/gid config from the plugin (not env) before the app serves — so
      // the first inserted snowflake and every gid encode/decode use these.
      setGidNamespace(options.gidNamespace ?? 'pylon')
      if (options.nodeId === 'lease') {
        nodeLease = await leaseNodeId(db)
        setSnowflakeNodeId(nodeLease.nodeId)
        // Free the slot on graceful shutdown (PM2 sends SIGINT/SIGTERM); a crash
        // is covered by the lease TTL. Best-effort — don't block or alter exit.
        const onShutdown = () => void nodeLease?.release()
        process.once('SIGINT', onShutdown)
        process.once('SIGTERM', onShutdown)
      } else if (typeof options.nodeId === 'number') {
        setSnowflakeNodeId(options.nodeId)
      }
    },

    async middleware(c, next) {
      if (!db) throw new Error('useDatabase: setup() did not run before the first request')
      // Bind the request connection + tenant/features/principal AROUND `next`, so
      // the binding covers resolver execution. Pylon composes plugin middlewares
      // into a chain (each `next` runs the rest → the GraphQL handler), so this
      // wrapping reaches the resolvers. The context is derived from the request
      // `c` (no `getContext()` ALS-timing dependency).
      // Default principal/tenant off the bound Principal (set by useIdentity at
      // PRINCIPAL_KEY) — so bare `useDatabase()` wires identity→ORM with no
      // boilerplate. Explicit options override (custom session shapes).
      const boundPrincipal = c.get(PRINCIPAL_KEY as never) as
        | {tenant?: string | number}
        | undefined
      const appCtx = {
        tenant: options.tenant ? options.tenant(c) : boundPrincipal?.tenant,
        // the feature provider may be async (DB/LaunchDarkly) — resolved once here
        features: await options.features?.(c),
        principal: options.principal ? options.principal(c) : boundPrincipal,
        debug:
          typeof options.debug === 'function' ? options.debug(c) : options.debug
      }
      const bound = () => runWithAppContext(appCtx, () => next())
      if (options.transactionPerRequest) {
        await db.kysely.transaction().execute(trx => databaseForKysely(trx).run(bound))
      } else {
        await db.run(bound)
      }
    },

    onExecute() {
      return {
        onExecuteDone({result, setResult}) {
          // `result` may be an async iterator (streamed/incremental delivery) —
          // only single execution results carry `errors` to remap.
          if (result == null || typeof (result as any)[Symbol.asyncIterator] === 'function') {
            return
          }
          const errors = (result as {errors?: readonly GraphQLError[]}).errors
          if (!Array.isArray(errors) || errors.length === 0) return
          let changed = false
          const mapped = errors.map(err => {
            const original = err.originalError
            // ValidationError → client-safe BAD_USER_INPUT (unless disabled).
            if (mapper && original instanceof ValidationError) {
              changed = true
              const {message, extensions} = mapper(original.issues)
              return new GraphQLError(message ?? err.message, {
                nodes: err.nodes,
                path: err.path,
                extensions: extensions ?? {}
              })
            }
            // ForbiddenError (authz denial) → FORBIDDEN (always mapped, not masked).
            if (original instanceof ForbiddenError) {
              changed = true
              return new GraphQLError(original.message, {
                nodes: err.nodes,
                path: err.path,
                extensions: {code: 'FORBIDDEN', feature: original.feature}
              })
            }
            // FeatureDisabledError → FEATURE_DISABLED ("upgrade your plan"), a
            // DISTINCT signal from FORBIDDEN so the client/UI can branch.
            if (original instanceof FeatureDisabledError) {
              changed = true
              return new GraphQLError(original.message, {
                nodes: err.nodes,
                path: err.path,
                extensions: {code: 'FEATURE_DISABLED', feature: original.feature}
              })
            }
            // NotFoundError (a `.get()` miss) → NOT_FOUND (not masked).
            if (original instanceof NotFoundError) {
              changed = true
              return new GraphQLError(original.message, {
                nodes: err.nodes,
                path: err.path,
                extensions: {code: 'NOT_FOUND', entity: original.entity}
              })
            }
            // BadRequestError (e.g. a malformed/wrong-type global id) → BAD_REQUEST.
            if (original instanceof BadRequestError) {
              changed = true
              return new GraphQLError(original.message, {
                nodes: err.nodes,
                path: err.path,
                extensions: {code: 'BAD_REQUEST'}
              })
            }
            return err
          })
          if (changed) setResult({...result, errors: mapped})
        }
      }
    }
  }
}
