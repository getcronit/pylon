import {handleStreamOrSingleExecutionResult, isOriginalGraphQLError} from '@envelop/core'
import {getLogger} from '../core/logger'
import type {Plugin} from '../core'

/**
 * Logs GraphQL execution errors through the runtime logger (rfcs/RUNTIME_LOGGER.md — Phase 3).
 *
 * Runs inside the request pipeline, so `getLogger()` is request-correlated. It is INDEPENDENT of
 * `useSentry` — that plugin captures to Sentry (@sentry/node) separately; this one only produces
 * structured log records. UNEXPECTED errors (a resolver threw a non-`GraphQLError`) are logged at
 * `error`; pure client `GraphQLError`s (validation / user error, visible in the response) are
 * `debug` so they don't flood a production log but are one `--verbose`/`LOG_LEVEL` away.
 */
export const useGraphqlErrorLogger = (): Plugin => ({
  onExecute() {
    return {
      onExecuteDone(payload: unknown) {
        return handleStreamOrSingleExecutionResult(payload as never, ({result}) => {
          const errors = result.errors
          if (!errors?.length) return
          const log = getLogger().withTag('graphql')
          for (const err of errors) {
            const fields = {
              path: err.path?.join('.'),
              code: (err.extensions as {code?: unknown} | undefined)?.code
            }
            if (isOriginalGraphQLError(err)) {
              log.debug('graphql client error', {message: err.message, ...fields})
            } else {
              log.error('graphql error', {err: err.originalError ?? err, ...fields})
            }
          }
        })
      }
    }
  }
})
