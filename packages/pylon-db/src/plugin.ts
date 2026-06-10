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
 * Decoupled: returns a plain object that's structurally a Pylon `Plugin`. The
 * only boundary-specific import is `graphql` (an optional peer present in every
 * Pylon app); the ORM core stays graphql-free.
 */
import {GraphQLError} from 'graphql'
import {runWithAppContext} from './app-context.js'
import {connect, databaseForKysely, getDatabase} from './database.js'
import {ForbiddenError} from './features.js'
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
   * Current tenant id for the request (e.g. `() => getContext().session?.organizationId`).
   * Bound into the ambient app context so tenant-scoped models auto-filter. Must
   * be null-safe (return undefined for unauthenticated/public requests).
   */
  tenant?: () => string | number | undefined
  /**
   * Features enabled for the current tenant (e.g. `() => getContext().session?.features`).
   * Bound into the ambient app context for feature gating. Null-safe.
   */
  features?: () => readonly string[] | undefined
}

export interface DatabasePlugin {
  setup(): void
  middleware(c: unknown, next: () => Promise<void>): Promise<void>
  onExecute?(): {onExecuteDone(payload: ExecuteDonePayload): void} | void
}

interface ExecuteDonePayload {
  result: {errors?: readonly GraphQLError[]} & Record<string, unknown>
  setResult(result: unknown): void
}

export function useDatabase(options: UseDatabaseOptions = {}): DatabasePlugin {
  const mapper =
    options.validationErrors === false
      ? null
      : options.validationErrors ?? defaultValidationErrorMapper

  return {
    setup() {
      connect({connectionString: options.connectionString ?? process.env.DATABASE_URL})
    },

    async middleware(_c, next) {
      const db = getDatabase()
      // Bind the request's tenant + features so tenant-scoped models auto-filter
      // and feature gates can read the enabled set.
      const appCtx = {tenant: options.tenant?.(), features: options.features?.()}
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
          const errors = result.errors
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
            // ForbiddenError (feature gate) → FORBIDDEN (always mapped, not masked).
            if (original instanceof ForbiddenError) {
              changed = true
              return new GraphQLError(original.message, {
                nodes: err.nodes,
                path: err.path,
                extensions: {code: 'FORBIDDEN', feature: original.feature}
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
