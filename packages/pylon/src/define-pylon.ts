import {
  GraphQLError,
  GraphQLErrorExtensions,
  GraphQLResolveInfo,
  SelectionSetNode
} from 'graphql'
import {Hono as _Hono} from 'hono'
import {Server, WebSocketHandler} from 'bun'
import * as Sentry from '@sentry/bun'

import {Context, Env, asyncContext, getContext} from './context'

export interface Resolvers<Q, M> {
  Query: Q
  Mutation: M
}

type WebSocketHandlerFunction<T extends Record<string, any>> = (
  server: Server
) => WebSocketHandler<T>

type Hono = _Hono<Env>

export interface PylonAPI {
  defineService: typeof defineService
  configureApp: (app: Hono) => Hono | void | Promise<void> | Promise<Hono>
  configureServer: (server: Server) => void
  configureWebsocket: WebSocketHandlerFunction<any>
}

type SingleResolver = ((...args: any[]) => any) | object

type ReturnTypeOrContext<T> = T extends (...args: any) => any
  ? ReturnType<T>
  : Context

export const defineService = <
  Q extends Record<string, SingleResolver>,
  M,
  Options extends {
    context: (context: Context) => ReturnTypeOrContext<Options['context']>
  }
>(
  plainResolvers: {
    Query?: Q
    Mutation?: M
  },
  options?: Options
) => {
  const typedPlainResolvers = plainResolvers as Resolvers<
    Q & {
      version: string
    },
    M
  >

  typedPlainResolvers.Query = {
    ...typedPlainResolvers.Query,
    version: 'NOT_IMPLEMENTED_YET'
  }

  const graphqlResolvers = resolversToGraphQLResolvers(
    typedPlainResolvers,
    options?.context
  )

  return {
    graphqlResolvers,
    plainResolvers: typedPlainResolvers,
    getContext: () => {
      return getContext() as ReturnType<Options['context']>
    }
  }
}

// function getAllPropertyNames(obj: any) {
//   function getAllPrototypePropertyNames(obj: any) {
//     let prototypePropertyNames: string[] = []
//     let prototype = Object.getPrototypeOf(obj)

//     while (prototype !== null && prototype !== Object.prototype) {
//       prototypePropertyNames = prototypePropertyNames.concat(
//         Object.getOwnPropertyNames(prototype)
//       )
//       prototype = Object.getPrototypeOf(prototype)
//     }

//     return Array.from(new Set(prototypePropertyNames))
//   }

//   if (obj === null) return []

//   const prototypeNames = getAllPrototypePropertyNames(obj)
//   const ownNames = Object.getOwnPropertyNames(obj)

//   return Array.from(new Set(prototypeNames.concat(ownNames)))
// }

type FunctionWrapper = (fn: (...args: any[]) => any) => (...args: any[]) => any

async function wrapFunctionsRecursively(
  obj: any,
  wrapper: FunctionWrapper,
  that: any = null,
  selectionSet: SelectionSetNode['selections'] = []
): Promise<any> {
  // Skip if the object is a Date object or any other special object.
  // Those objects are then handled by custom resolvers.
  if (obj === null || obj instanceof Date) {
    return obj
  }

  if (Array.isArray(obj)) {
    return await Promise.all(
      obj.map(async item => {
        return await wrapFunctionsRecursively(item, wrapper, that, selectionSet)
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
        return await wrapper.call(that, obj, selectionSet)
      }
    )
  } else if (obj instanceof Promise) {
    return await wrapFunctionsRecursively(
      await obj,
      wrapper,
      that,
      selectionSet
    )
  } else if (typeof obj === 'object') {
    const result: any = {}

    const fields: {
      key: string
      selectionSet: SelectionSetNode['selections']
    }[] = []

    that = obj

    for (const selection of selectionSet) {
      if (selection.kind === 'Field') {
        selection.selectionSet

        fields.push({
          key: selection.name.value,
          selectionSet: selection.selectionSet?.selections || []
        })
      }
    }

    for (const {key, selectionSet} of Object.values(fields)) {
      result[key] = await wrapFunctionsRecursively(
        obj[key],
        wrapper,
        that,
        selectionSet
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
      selections
    )

    return result as ReturnType<typeof fn>
  }
}
type GraphQLResolvers = {
  Query: Record<string, any>
  Mutation: Record<string, any>
}

/**
 * Converts a set of resolvers into a corresponding set of GraphQL resolvers.
 * @param resolvers The original resolvers.
 * @returns The converted GraphQL resolvers.
 */
const resolversToGraphQLResolvers = <Q, M>(
  resolvers: Resolvers<Q, M>,
  configureContext?: (context: Context) => Context
): GraphQLResolvers => {
  // Define a root resolver function that maps a given resolver function or object to a GraphQL resolver.
  const rootGraphqlResolver =
    (fn: Function | object | Promise<Function> | Promise<object>) =>
    async (_: object, args: Record<string, any>, ctx: Context, info: any) => {
      return Sentry.withScope(async scope => {
        const ctx = asyncContext.getStore()

        if (!ctx) {
          throw new Error('Internal error. Context not defined.')
        }

        const auth = ctx.get('auth')

        if (auth?.active) {
          scope.setUser({
            id: auth.sub,
            username: auth.preferred_username,
            email: auth.email,
            details: auth
          })
        }

        if (configureContext) {
          const configuredCtx = await Sentry.startSpan(
            {
              name: 'Context',
              op: 'pylon.context'
            },
            () => configureContext(ctx)
          )

          asyncContext.enterWith(configuredCtx)
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
          baseSelectionSet
        )

        // Call the resolver function with the prepared arguments.
        if (typeof wrappedFn !== 'function') {
          return wrappedFn
        }

        return await wrappedFn(preparedArguments)
      })
    }

  // Convert the Query and Mutation resolvers to GraphQL resolvers.
  const graphqlResolvers = {} as GraphQLResolvers

  if (resolvers.Query) {
    for (const [key, value] of Object.entries(resolvers.Query)) {
      if (!graphqlResolvers.Query) {
        graphqlResolvers.Query = {}
      }

      graphqlResolvers.Query[key] = rootGraphqlResolver(
        value as Function | object
      )
    }
  }

  if (resolvers.Mutation) {
    if (!graphqlResolvers.Mutation) {
      graphqlResolvers.Mutation = {}
    }

    for (const [key, value] of Object.entries(resolvers.Mutation)) {
      graphqlResolvers.Mutation[key] = rootGraphqlResolver(
        value as Function | object
      )
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
