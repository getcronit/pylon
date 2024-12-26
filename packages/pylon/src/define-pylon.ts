import * as Sentry from '@sentry/bun'
import consola from 'consola'
import {
  FragmentDefinitionNode,
  GraphQLError,
  GraphQLErrorExtensions,
  GraphQLObjectType,
  GraphQLResolveInfo,
  SelectionSetNode
} from 'graphql'

import {Context, asyncContext} from './context'
import {isAsyncIterable, Maybe} from 'graphql-yoga'

export interface Resolvers {
  Query: Record<string, any>
  Mutation?: Record<string, any>
  Subscription?: Record<string, any>
}

type FunctionWrapper = (fn: (...args: any[]) => any) => (...args: any[]) => any

function getAllPropertyNames(instance: any): string[] {
  const allProps = new Set<string>()

  // Traverse the prototype chain
  let currentObj: any = instance

  while (currentObj && currentObj !== Object.prototype) {
    // Get all own property names of the current object
    const ownProps = Object.getOwnPropertyNames(currentObj)

    // Add each property to the Set
    ownProps.forEach(prop => allProps.add(prop))

    // Move up the prototype chain
    currentObj = Object.getPrototypeOf(currentObj)
  }

  // Convert Set to array and filter out the constructor if desired
  return Array.from(allProps).filter(prop => prop !== 'constructor')
}

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
  } else if (isAsyncIterable(obj)) {
    return obj
  } else if (typeof obj === 'object') {
    that = obj

    const result: Record<string, any> = {}

    for (const key of getAllPropertyNames(obj)) {
      result[key] = await wrapFunctionsRecursively(
        obj[key],
        wrapper,
        that,
        selectionSet,
        info
      )
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
    async (
      _: object,
      args: Record<string, any>,
      ctx: Context,
      info: GraphQLResolveInfo
    ) => {
      return Sentry.withScope(async scope => {
        const ctx = asyncContext.getStore()


        if (!ctx) {
          consola.warn(
            'Context is not defined. Make sure AsyncLocalStorage is supported in your environment.'
          )
        }

        ctx?.set("graphqlResolveInfo", info)

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

        let type: Maybe<GraphQLObjectType> | null = null

        switch (info.operation.operation) {
          case 'query':
            type = info.schema.getQueryType()
            break
          case 'mutation':
            type = info.schema.getMutationType()
            break
          case 'subscription':
            type = info.schema.getSubscriptionType()
            break
          default:
            throw new Error('Unknown operation')
        }

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

        const res = await wrappedFn(preparedArguments)

        return res
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

  if (
    resolvers.Subscription &&
    Object.keys(resolvers.Subscription).length > 0
  ) {
    if (!graphqlResolvers.Subscription) {
      graphqlResolvers.Subscription = {}
    }

    for (const [key, value] of Object.entries(resolvers.Subscription)) {
      graphqlResolvers.Subscription[key] = {
        subscribe: rootGraphqlResolver(value as Function | object),
        resolve: (payload: any) => payload
      }
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

  // Add extra resolvers (e.g. custom scalars) to the GraphQL resolvers.
  for (const key of Object.keys(resolvers)) {
    if (key !== 'Query' && key !== 'Mutation' && key !== 'Subscription') {
      graphqlResolvers[key] = resolvers[key]
    }
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
