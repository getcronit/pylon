import type {OperationDefinitionNode} from 'graphql'
import type {Plugin} from '../core/index.js'
import {getContext} from '../core/context.js'
import {IN_CONTEXT_KEY, type InContext} from '../core/in-context.js'

/**
 * Read `@inContext` off the executing operation and expose it to resolvers via
 * `getLocale()` / `getInContext()`.
 *
 * Runs in `onExecute`, after parse and validate, so the document is known-good and the
 * variable values are coerced. Still inside the request's async scope, so the Hono context
 * is reachable — that is the same channel `getContext()` reads, which is what pylon
 * resolvers already use.
 *
 * See `core/in-context.ts` for why this is a directive rather than a header.
 */
export const useInContext = (): Plugin => ({
  name: 'in-context',
  onExecute({args}) {
    const operation = args.document.definitions.find(
      (d): d is OperationDefinitionNode =>
        d.kind === 'OperationDefinition' &&
        (!args.operationName || d.name?.value === args.operationName)
    )
    const directive = operation?.directives?.find(d => d.name.value === 'inContext')
    if (!directive) return

    const context: InContext = {}
    for (const arg of directive.arguments ?? []) {
      if (arg.name.value !== 'locale') continue
      // A variable (the compiled form — one document serves every locale) or an inline
      // literal (a hand-written query).
      const value =
        arg.value.kind === 'Variable'
          ? (args.variableValues as Record<string, unknown> | null)?.[
              arg.value.name.value
            ]
          : arg.value.kind === 'StringValue'
            ? arg.value.value
            : undefined
      if (typeof value === 'string' && value) context.locale = value
    }
    if (!context.locale) return

    try {
      getContext().set(IN_CONTEXT_KEY as never, context as never)
    } catch {
      // No request context (an in-process execution outside a request) — nothing to bind to.
    }
  }
})
