import {
  GraphQLError,
  GraphQLErrorExtensions,
  GraphQLResolveInfo,
  SelectionSetNode
} from 'graphql'
import {Hono} from 'hono'

import {
  BaseContext,
  Context,
  ContextualFunction,
  FnWithContext,
  MaybeWithContext
} from './withContext'
import type {Server as HTTPServer} from 'http'
import type {Server as HTTPSServer} from 'https'

export interface Resolvers<Q, M> {
  Query: Q
  Mutation: M
}

export interface Options {
  configureApp: (app: Hono) => Hono | void | Promise<void> | Promise<Hono>
  configureServer?: (server: HTTPSServer | HTTPServer) => void
}

type SingleResolver = ((...args: any[]) => any) | object | FnWithContext

export const defineService = <Q extends Record<string, SingleResolver>, M>(
  plainResolvers: {
    Query?: Q
    Mutation?: M
  },
  options: Options = {
    configureApp: app => app,
    configureServer: server => server
  }
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

  const graphqlResolvers = resolversToGraphQLResolvers(typedPlainResolvers)

  return {
    graphqlResolvers,
    plainResolvers: typedPlainResolvers,
    options
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
  selectionSet: SelectionSetNode['selections'] = [],
  context: Context
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
          context
        )
      })
    )
  } else if (typeof obj === 'function') {
    if (obj.wrappedWithContext) {
      obj = await obj(context)

      return await wrapFunctionsRecursively(
        obj,
        wrapper,
        that,
        selectionSet,
        context
      )
    }

    // @ts-ignore
    return await wrapper.call(that, obj, selectionSet, context)
  } else if (obj instanceof Promise) {
    return await wrapFunctionsRecursively(
      await obj,
      wrapper,
      that,
      selectionSet,
      context
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
        selectionSet,
        context
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
  return (otherArgs: Record<string, any>, _: any, info: GraphQLResolveInfo) => {
    const selections = arguments[1] as SelectionSetNode['selections']
    const context = arguments[2] as Context

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

    const result = wrapFunctionsRecursively(
      fn.call(this || {}, ...orderedArgs),
      spreadFunctionArguments,
      this,
      selections,
      context
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
  resolvers: Resolvers<Q, M>
): GraphQLResolvers => {
  // Define a root resolver function that maps a given resolver function or object to a GraphQL resolver.
  const rootGraphqlResolver =
    (fn: Function | object | Promise<Function> | Promise<object>) =>
    async (
      _: object,
      args: Record<string, any>,
      context: BaseContext,
      info: any
    ) => {
      // Get the path and field metadata for the current query.
      const path = info.path

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

      const field = type?.getFields()[path.key]

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
      let inner: object | Function

      const awaitedFn = await fn

      if (typeof awaitedFn === 'object') {
        inner = awaitedFn
      } else {
        inner = (awaitedFn as MaybeWithContext<ContextualFunction<any, any>>)
          .wrappedWithContext
          ? await awaitedFn(context)
          : fn
      }

      let baseSelectionSet: SelectionSetNode['selections'] = []

      // Find the selection set for the current field.
      for (const selection of info.operation.selectionSet.selections) {
        if (selection.kind === 'Field' && selection.name.value === path.key) {
          baseSelectionSet = selection.selectionSet?.selections || []
        }
      }

      // Wrap the resolver function with any required middleware.
      const wrappedFn = await wrapFunctionsRecursively(
        inner,
        spreadFunctionArguments,
        this,
        baseSelectionSet,
        context
      )

      // Call the resolver function with the prepared arguments.
      if (typeof wrappedFn !== 'function') {
        return wrappedFn
      }

      return wrappedFn(preparedArguments)
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
      message: string
    }
  ) {
    super(message)
    this.extensions = extensions
  }
}
