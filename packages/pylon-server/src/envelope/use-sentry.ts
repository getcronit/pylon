import {GraphQLError, Kind, OperationDefinitionNode, print} from 'graphql'
import {
  getDocumentString,
  handleStreamOrSingleExecutionResult,
  isOriginalGraphQLError,
  OnExecuteDoneHookResultOnNextHook,
  TypedExecutionArgs,
  type Plugin
} from '@envelop/core'
import * as Sentry from '@sentry/bun'
import type {TraceparentData} from '@sentry/types'

export type SentryPluginOptions<PluginContext extends Record<string, any>> = {
  /**
   * Adds result of each resolver and operation to Span's data (available under "result")
   * @default false
   */
  includeRawResult?: boolean
  /**
   * Adds arguments of each resolver to Span's tag called "args"
   * @default false
   */
  includeResolverArgs?: boolean
  /**
   * Adds operation's variables to a Scope (only in case of errors)
   * @default false
   */
  includeExecuteVariables?: boolean
  /**
   * The key of the event id in the error's extension. `null` to disable.
   * @default sentryEventId
   */
  eventIdKey?: string | null
  /**
   * Adds custom tags to every Transaction.
   */
  appendTags?: (
    args: TypedExecutionArgs<PluginContext>
  ) => Record<string, unknown>
  /**
   * Produces a name of Transaction (only when "renameTransaction" or "startTransaction" are enabled) and description of created Span.
   *
   * @default operation's name or "Anonymous Operation" when missing)
   */
  transactionName?: (args: TypedExecutionArgs<PluginContext>) => string
  /**
   * Produces tracing data for Transaction
   *
   * @default is empty
   */
  traceparentData?: (
    args: TypedExecutionArgs<PluginContext>
  ) => TraceparentData | undefined
  /**
   * Produces a "op" (operation) of created Span.
   *
   * @default execute
   */
  operationName?: (args: TypedExecutionArgs<PluginContext>) => string
  /**
   * Indicates whether or not to skip the entire Sentry flow for given GraphQL operation.
   * By default, no operations are skipped.
   */
  skip?: (args: TypedExecutionArgs<PluginContext>) => boolean
  /**
   * Indicates whether or not to skip Sentry exception reporting for a given error.
   * By default, this plugin skips all `GraphQLError` errors and does not report it to Sentry.
   */
  skipError?: (args: Error) => boolean
}

export const useSentry = <PluginContext extends Record<string, any> = {}>(
  options: SentryPluginOptions<PluginContext> = {}
): Plugin<PluginContext> => {
  function pick<K extends keyof SentryPluginOptions<PluginContext>>(
    key: K,
    defaultValue: NonNullable<SentryPluginOptions<PluginContext>[K]>
  ) {
    return options[key] ?? defaultValue
  }

  const includeRawResult = pick('includeRawResult', false)
  const includeExecuteVariables = pick('includeExecuteVariables', false)
  const skipOperation = pick('skip', () => false)

  const eventIdKey = options.eventIdKey === null ? null : 'sentryEventId'

  function addEventId(err: GraphQLError, eventId: string | null): GraphQLError {
    if (eventIdKey !== null && eventId !== null) {
      err.extensions[eventIdKey] = eventId
    }

    return err
  }

  return {
    onExecute({args}) {
      if (skipOperation(args)) {
        return
      }

      const rootOperation = args.document.definitions.find(
        o => o.kind === Kind.OPERATION_DEFINITION
      ) as OperationDefinitionNode
      const operationType = rootOperation.operation

      const document = getDocumentString(args.document, print)

      const opName =
        args.operationName || rootOperation.name?.value || 'Anonymous Operation'
      const addedTags: Record<string, any> =
        (options.appendTags && options.appendTags(args)) || {}
      const traceparentData =
        (options.traceparentData && options.traceparentData(args)) || {}

      const transactionName = options.transactionName
        ? options.transactionName(args)
        : opName
      const op = options.operationName ? options.operationName(args) : 'execute'
      const tags = {
        operationName: opName,
        operation: operationType,
        ...addedTags
      }

      return Sentry.startSpan({name: transactionName, op, tags}, span => {
        span?.setAttribute('document', document)

        return {
          onExecuteDone(payload) {
            const handleResult: OnExecuteDoneHookResultOnNextHook<{}> = ({
              result,
              setResult
            }) => {
              if (includeRawResult) {
                span?.setAttribute('result', JSON.parse(JSON.stringify(result)))
              }

              if (result.errors && result.errors.length > 0) {
                Sentry.withScope(scope => {
                  scope.setTransactionName(opName)
                  scope.setTag('operation', operationType)
                  scope.setTag('operationName', opName)
                  scope.setExtra('document', document)
                  scope.setTags(addedTags || {})

                  if (includeRawResult) {
                    scope.setExtra('result', result)
                  }

                  if (includeExecuteVariables) {
                    scope.setExtra('variables', args.variableValues)
                  }

                  const errors = result.errors?.map(err => {
                    const errorPath = (err.path ?? [])
                      .map((v: string | number) =>
                        typeof v === 'number' ? '$index' : v
                      )
                      .join(' > ')

                    if (errorPath) {
                      scope.addBreadcrumb({
                        category: 'execution-path',
                        message: errorPath,
                        level: 'debug'
                      })
                    }

                    const eventId = Sentry.captureException(err.originalError, {
                      fingerprint: [
                        'graphql',
                        errorPath,
                        opName,
                        operationType
                      ],
                      level: isOriginalGraphQLError(err) ? 'info' : 'error',
                      contexts: {
                        GraphQL: {
                          operationName: opName,
                          operationType,
                          variables: args.variableValues
                        }
                      }
                    })

                    return addEventId(err, eventId)
                  })

                  setResult({
                    ...result,
                    errors
                  })
                })
              }

              span?.end()
            }

            return handleStreamOrSingleExecutionResult(payload, handleResult)
          }
        }
      })
    }
  }
}
