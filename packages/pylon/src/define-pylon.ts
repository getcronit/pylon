import * as Sentry from '@sentry/bun'
import consola from 'consola'
import {
  FragmentDefinitionNode,
  GraphQLError,
  GraphQLErrorExtensions,
  GraphQLResolveInfo,
  SelectionSetNode
} from 'graphql'

import {Context, asyncContext} from './context'

export interface Resolvers {
  Query: Record<string, any>
  Mutation: Record<string, any>
}

type FunctionWrapper = (fn: (...args: any[]) => any) => (...args: any[]) => any

async function wrapFunctionsRecursively(
  obj: any,
  wrapper: FunctionWrapper,
  that: any = null,
  selectionSet: SelectionSetNode['selections'] = [],
  info: GraphQLResolveInfo
): Promise<any> {
  // Skip if the object is a Date object or any other special object.
  // Those objects are then handled by custom resolvers.
  if (obj === null || obj instanceof Date) {
    return obj
  }

  if (Array.isArray(obj)) {
    return await Promise.all(
      obj.map(async item => {
        return await wrapFunctionsRecursively(
          item,
          wrapper,
          that,
          selectionSet,
          info
        )
      })
    )
  } else if (typeof obj === 'function') {
    return Sentry.startSpan(
      {
        name: obj.name,
        op: 'pylon.fn'
      },
      async () => {
        // @ts-ignore
        return await wrapper.call(that, obj, selectionSet, info)
      }
    )
  } else if (obj instanceof Promise) {
    return await wrapFunctionsRecursively(
      await obj,
      wrapper,
      that,
      selectionSet,
      info
    )
  } else if (typeof obj === 'object') {
    const result: any = {}

    const fields: {
      key: string
      selectionSet: SelectionSetNode['selections']
    }[] = []

    that = obj

    const resolveFragmentSpreadFields = (fragment: FragmentDefinitionNode) => {
      const fragmentFields: typeof fields = []

      for (const fragmentSelection of fragment.selectionSet.selections) {
        if (fragmentSelection.kind === 'Field') {
          fragmentFields.push({
            key: fragmentSelection.name.value,
            selectionSet: fragmentSelection.selectionSet?.selections || []
          })
        } else if (fragmentSelection.kind === 'InlineFragment') {
          consola.warn(`Inline fragments are not supported yet.`)
        } else if (fragmentSelection.kind === 'FragmentSpread') {
          const fragment = info.fragments[fragmentSelection.name.value]

          fragmentFields.push(...resolveFragmentSpreadFields(fragment))
        }
      }

      return fragmentFields
    }

    for (const selection of selectionSet) {
      if (selection.kind === 'Field') {
        fields.push({
          key: selection.name.value,
          selectionSet: selection.selectionSet?.selections || []
        })
      } else if (selection.kind === 'InlineFragment') {
        consola.warn(`Inline fragments are not supported yet.`)
      } else if (selection.kind === 'FragmentSpread') {
        const fragment = info.fragments[selection.name.value]

        fields.push(...resolveFragmentSpreadFields(fragment))
      }
    }

    for (const {key, selectionSet} of Object.values(fields)) {
      result[key] = await wrapFunctionsRecursively(
        obj[key],
        wrapper,
        that,
        selectionSet,
        info
      )
    }

    // If no fields were selected, return the original object.
    if (Object.keys(result).length === 0) {
      return obj
    }

    return result
  } else {
    return await obj
  }
}
function spreadFunctionArguments<T extends (...args: any[]) => any>(fn: T) {
  return (otherArgs: Record<string, any>, c: any, info: GraphQLResolveInfo) => {
    const selections = arguments[1] as SelectionSetNode['selections']
    const realInfo = arguments[2] as GraphQLResolveInfo

    let args: Record<string, any> = {}

    if (info) {
      const type = info.parentType

      const field = type.getFields()[info.fieldName]

      const fieldArguments = field?.args

      const preparedArguments = fieldArguments?.reduce(
        (acc: {[x: string]: undefined}, arg: {name: string | number}) => {
          if (otherArgs[arg.name] !== undefined) {
            acc[arg.name] = otherArgs[arg.name]
          } else {
            acc[arg.name] = undefined
          }

          return acc
        },
        {} as Record<string, any>
      )

      if (preparedArguments) {
        args = preparedArguments
      }
    } else {
      args = otherArgs
    }

    const orderedArgs = Object.keys(args).map(key => args[key])

    const that = this || {}

    const result = wrapFunctionsRecursively(
      fn.call(that, ...orderedArgs),
      spreadFunctionArguments,
      this,
      selections,
      realInfo
    )

    return result as ReturnType<typeof fn>
  }
}

/**
 * Converts a set of resolvers into a corresponding set of GraphQL resolvers.
 * @param resolvers The original resolvers.
 * @returns The converted GraphQL resolvers.
 */
export const resolversToGraphQLResolvers = (
  resolvers: Resolvers,
  configureContext?: (context: Context) => Context
): Resolvers => {
  // Define a root resolver function that maps a given resolver function or object to a GraphQL resolver.
  const rootGraphqlResolver =
    (fn: Function | object | Promise<Function> | Promise<object>) =>
    async (_: object, args: Record<string, any>, ctx: Context, info: any) => {
      return Sentry.withScope(async scope => {
        const ctx = asyncContext.getStore()

        if (!ctx) {
          consola.warn(
            'Context is not defined. Make sure AsyncLocalStorage is supported in your environment.'
          )
        }

        const auth = ctx?.get('auth')

        if (auth?.active) {
          scope.setUser({
            id: auth.sub,
            username: auth.preferred_username,
            email: auth.email,
            details: auth
          })
        }

        // get query or mutation field

        const isQuery = info.operation.operation === 'query'
        const isMutation = info.operation.operation === 'mutation'

        if (!isQuery && !isMutation) {
          throw new Error('Only queries and mutations are supported.')
        }

        // Get the field metadata for the current query or mutation.
        const type = isQuery
          ? info.schema.getQueryType()
          : info.schema.getMutationType()

        const field = type?.getFields()[info.fieldName]

        // Get the list of arguments expected by the current query field.
        const fieldArguments = field?.args || []

        // Prepare the arguments for the resolver function call by adding any missing arguments with an undefined value.
        const preparedArguments = fieldArguments.reduce(
          (acc: {[x: string]: undefined}, arg: {name: string | number}) => {
            if (args[arg.name] !== undefined) {
              acc[arg.name] = args[arg.name]
            } else {
              acc[arg.name] = undefined
            }

            return acc
          },
          {} as Record<string, any>
        )

        // Determine the resolver function to call (either the given function or the wrappedWithContext function if it exists).
        let inner = await fn

        let baseSelectionSet: SelectionSetNode['selections'] = []

        // Find the selection set for the current field.
        for (const selection of info.operation.selectionSet.selections) {
          if (
            selection.kind === 'Field' &&
            selection.name.value === info.fieldName
          ) {
            baseSelectionSet = selection.selectionSet?.selections || []
          }
        }

        // Wrap the resolver function with any required middleware.
        const wrappedFn = await wrapFunctionsRecursively(
          inner,
          spreadFunctionArguments,
          this,
          baseSelectionSet,
          info
        )

        // Call the resolver function with the prepared arguments.
        if (typeof wrappedFn !== 'function') {
          return wrappedFn
        }

        return await wrappedFn(preparedArguments)
      })
    }

  // Convert the Query and Mutation resolvers to GraphQL resolvers.
  const graphqlResolvers = {} as Resolvers

  // Remove empty resolvers
  for (const key of Object.keys(resolvers.Query)) {
    if (!resolvers.Query[key]) {
      delete resolvers.Query[key]
    }
  }

  if (resolvers.Query && Object.keys(resolvers.Query).length > 0) {
    for (const [key, value] of Object.entries(resolvers.Query)) {
      if (!graphqlResolvers.Query) {
        graphqlResolvers.Query = {}
      }

      graphqlResolvers.Query[key] = rootGraphqlResolver(
        value as Function | object
      )
    }
  }

  if (resolvers.Mutation && Object.keys(resolvers.Mutation).length > 0) {
    if (!graphqlResolvers.Mutation) {
      graphqlResolvers.Mutation = {}
    }

    for (const [key, value] of Object.entries(resolvers.Mutation)) {
      graphqlResolvers.Mutation[key] = rootGraphqlResolver(
        value as Function | object
      )
    }
  }

  // Query root type must be provided.
  if (!graphqlResolvers.Query) {
    // Custom Error for Query root type must be provided.

    throw new Error(`At least one 'Query' resolver must be provided.

Example:

export const graphql = {
  Query: {
    // Define at least one query resolver here
    hello: () => 'world'
  }
}
`)
  }

  return graphqlResolvers
}

export class ServiceError extends GraphQLError {
  extensions: GraphQLErrorExtensions

  constructor(
    message: string,
    extensions: {
      code: string
      statusCode: number
      details?: Record<string, any>
    },
    error?: Error
  ) {
    super(message, {
      originalError: error
    })
    this.extensions = extensions
    this.cause = error
  }
}
