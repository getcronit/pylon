import * as Sentry from '@sentry/bun'
import consola from 'consola'
import {
  GraphQLError,
  GraphQLErrorExtensions,
  GraphQLObjectType,
  GraphQLResolveInfo
} from 'graphql'

import {AsyncLocalStorage} from 'async_hooks'
import {Maybe} from 'graphql-yoga'
import {asyncContext, Context} from './context'
import {getExecutionContext} from './get-execution-context'

export interface Resolvers {
  Query: Record<string, any>
  Mutation?: Record<string, any>
  Subscription?: Record<string, any>
}

export interface ExecutionArgument {
  name: string
  value: any
}

export interface ExecutionContext {
  name: string
  fields: ExecutionContext[]
  arguments: ExecutionArgument[]
}

export const executionAsyncContext = new AsyncLocalStorage<ExecutionContext>()

export const getResolveInfo = () => {
  const store = executionAsyncContext.getStore()

  if (!store) {
    throw new Error('Resolve info is not available')
  }

  return store
}

type PrimitiveType = string | number | boolean | null | undefined

type ResolverType =
  | Function
  | object
  | Promise<Function>
  | Promise<object>
  | PrimitiveType

const wrapResolver = (
  resolver: ResolverType,
  context: ExecutionContext
): any => {
  // Changed return type to allow sync returns

  // 1. FAST PATH: Primitives & Nulls
  if (
    resolver === null ||
    (typeof resolver !== 'object' && typeof resolver !== 'function')
  ) {
    return resolver
  }

  // 2. LEAF OBJECTS: Dates
  if (resolver instanceof Date) return resolver

  // 3. ASYNC NODES: Promises
  if (typeof (resolver as any).then === 'function') {
    // We can't await here if we want to stay sync-first.
    // We chain the promise and recurse.
    return (resolver as any).then((resolved: any) =>
      wrapResolver(resolved, context)
    )
  }

  // 4. COLLECTIONS: Arrays
  if (Array.isArray(resolver)) {
    const results = resolver.map(item => wrapResolver(item, context))

    // Performance: Check if any result is a Promise
    if (results.some(r => r && typeof r.then === 'function')) {
      return Promise.all(results)
    }
    return results
  }

  // 5. EXECUTABLES: Functions
  // >>> THIS IS THE OPTIMIZATION <<<
  // We only activate ALS here, right before calling the user's function.
  if (typeof resolver === 'function') {
    return executionAsyncContext.run(context, () => {
      const args = context.arguments.map(arg => arg.value)
      // Recurse on the result
      return wrapResolver(resolver(...args), context)
    })
  }

  // 6. COMPLEX NODES: Objects
  const result: Record<string, any> = {}
  const fields = context.fields

  // We track promises only if they occur
  const promises: Promise<void>[] = []

  for (let i = 0; i < fields.length; i++) {
    const fieldCtx = fields[i]
    const fieldName = fieldCtx.name
    const rawValue = (resolver as any)[fieldName]

    if (rawValue === undefined) continue

    // RECURSION: We pass 'fieldCtx' explicitly as an argument.
    // We DO NOT wrap this in ALS.run().
    // If rawValue turns out to be a function (Step 5), ALS will trigger then.
    const resolved = wrapResolver(rawValue, fieldCtx)

    // Handle Async vs Sync results efficiently
    if (resolved && typeof resolved.then === 'function') {
      promises.push(
        resolved.then((v: any) => {
          result[fieldName] = v
        })
      )
    } else {
      result[fieldName] = resolved
    }
  }

  if (promises.length > 0) {
    return Promise.all(promises).then(() => result)
  }

  return result
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
    (resolver: ResolverType) =>
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

        ctx?.set('graphqlResolveInfo', info)

        const auth = ctx?.get('auth')

        if (auth?.user) {
          scope.setUser({
            id: auth.user.sub,
            username: auth.user.preferred_username,
            email: auth.user.email,
            details: auth.user
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

        const executionContext = getExecutionContext(info)

        return executionAsyncContext.run(executionContext, async () => {
          const maybeFn = wrapResolver(resolver, executionContext)

          return maybeFn
        })
      })
    }

  // Convert the Query and Mutation resolvers to GraphQL resolvers.
  const graphqlResolvers = {} as Resolvers

  if (resolvers.Query && Object.keys(resolvers.Query).length > 0) {
    for (const [key, value] of Object.entries(resolvers.Query)) {
      if (!graphqlResolvers.Query) {
        graphqlResolvers.Query = {}
      }

      graphqlResolvers.Query[key] = rootGraphqlResolver(value)
    }
  }

  if (resolvers.Mutation && Object.keys(resolvers.Mutation).length > 0) {
    if (!graphqlResolvers.Mutation) {
      graphqlResolvers.Mutation = {}
    }

    for (const [key, value] of Object.entries(resolvers.Mutation)) {
      graphqlResolvers.Mutation[key] = rootGraphqlResolver(value)
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
        subscribe: rootGraphqlResolver(value),
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
