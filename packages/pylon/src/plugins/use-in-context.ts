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

    // Resolve an argument to its string value: a variable (the compiled form — one
    // document serves every value) or an inline literal (a hand-written query).
    const argValue = (name: string): string | undefined => {
      const arg = directive.arguments?.find(a => a.name.value === name)
      if (!arg) return undefined
      const value =
        arg.value.kind === 'Variable'
          ? (args.variableValues as Record<string, unknown> | null)?.[
              arg.value.name.value
            ]
          : arg.value.kind === 'StringValue'
            ? arg.value.value
            : undefined
      return typeof value === 'string' && value ? value : undefined
    }

    const inContext: InContext = {}
    const locale = argValue('locale')
    if (locale) inContext.locale = locale
    // `context` rides as a JSON string (app-independent SDL). Parse it into the typed bag;
    // a malformed value is ignored rather than failing the operation.
    const contextJson = argValue('context')
    if (contextJson) {
      try {
        const parsed = JSON.parse(contextJson)
        if (parsed && typeof parsed === 'object') inContext.context = parsed
      } catch {
        // ignore a malformed context blob
      }
    }
    // Nothing resolved (e.g. the variables were all null) — leave the context unset.
    if (inContext.locale === undefined && inContext.context === undefined) return

    try {
      getContext().set(IN_CONTEXT_KEY as never, inContext as never)
    } catch {
      // No request context (an in-process execution outside a request) — nothing to bind to.
    }
  }
})
