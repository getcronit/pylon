import {GraphQLScalarType, Kind} from 'graphql'
import {
  DateTimeISOResolver,
  GraphQLVoid,
  JSONObjectResolver,
  JSONResolver
} from 'graphql-scalars'
import {createSchema, createYoga} from 'graphql-yoga'
import {logger} from 'hono/logger'

import {useDisableIntrospection} from '@envelop/disable-introspection'
import {readFileSync} from 'fs'
import path from 'path'
import {app, PylonConfig} from '../..'
import {Context, getContext} from '../../context'
import {resolversToGraphQLResolvers} from '../../define-pylon'
import {useSentry} from '../envelop/use-sentry'
import {useViewer} from '../envelop/use-viewer'

interface PylonHandlerOptions {
  graphql: {
    Query: Record<string, any>
    Mutation?: Record<string, any>
    Subscription?: Record<string, any>
  }
  config?: PylonConfig
}

export const handler = (options: PylonHandlerOptions) => {
  let {typeDefs, resolvers, graphql, config} =
    options as PylonHandlerOptions & {
      typeDefs?: string
      resolvers?: Record<string, any>
    }

  if (!typeDefs) {
    // Try to read the schema from the default location
    const schemaPath = path.join(process.cwd(), '.pylon', 'schema.graphql')

    // If `schemaPath` is provided, read the schema from the file
    if (schemaPath) {
      typeDefs = readFileSync(schemaPath, 'utf-8')
    }
  }

  if (!typeDefs) {
    throw new Error('No schema provided.')
  }

  if (!resolvers) {
    // Try to read the resolvers from the default location
    const resolversPath = path.join(process.cwd(), '.pylon', 'resolvers.js')

    // If `resolversPath` is provided, read the resolvers from the file

    if (resolversPath) {
      resolvers = require(resolversPath).resolvers
    }
  }

  const graphqlResolvers = resolversToGraphQLResolvers(graphql)

  const schema = createSchema<Context>({
    typeDefs,
    resolvers: {
      ...graphqlResolvers,
      ...resolvers,
      // Transforms a date object to a timestamp
      Date: DateTimeISOResolver,
      JSON: JSONResolver,
      Object: JSONObjectResolver,
      Void: GraphQLVoid,
      Number: new GraphQLScalarType({
        name: 'Number',
        description: 'Custom scalar that handles both integers and floats',

        // Parsing input from query variables
        parseValue(value) {
          if (typeof value !== 'number') {
            throw new TypeError(`Value is not a number: ${value}`)
          }
          return value // Valid number
        },

        // Validation when sending from client (input literals)
        parseLiteral(ast) {
          if (ast.kind === Kind.INT || ast.kind === Kind.FLOAT) {
            return parseFloat(ast.value) // Convert the value to a float
          }
          throw new TypeError(
            `Value is not a valid number or float: ${
              'value' in ast ? ast.value : ast
            }`
          )
        },

        // Serialize output to be sent to the client
        serialize(value) {
          if (typeof value !== 'number') {
            throw new TypeError(`Value is not a number: ${value}`)
          }
          return value
        }
      })
    }
  })

  const resolveGraphiql = (config?: PylonConfig) => {
    const graphiqlOptions = {
      shouldPersistHeaders: true,
      title: 'Pylon Playground',
      defaultQuery: `# Welcome to the Pylon Playground!`
    }

    if (typeof config?.graphiql === 'undefined') {
      return graphiqlOptions
    }

    if (typeof config.graphiql === 'boolean') {
      return config.graphiql ? graphiqlOptions : false
    }

    if (typeof config.graphiql === 'function') {
      const c = getContext()
      return config.graphiql(c) ? graphiqlOptions : false
    }

    return false // fallback safeguard
  }

  const yoga = createYoga({
    landingPage: false,
    graphqlEndpoint: '/graphql',
    ...config,
    graphiql: async () => resolveGraphiql(config),
    plugins: [
      useSentry(),
      useDisableIntrospection({
        disableIf: () => {
          const disable = resolveGraphiql(config) === false

          return disable
        }
      }),
      useViewer({
        disableIf: () => {
          const disable = resolveGraphiql(config) === false

          return disable
        }
      }),
      ...(config?.plugins || [])
    ],
    schema
  })

  if (config?.logger !== false) {
    app.use('*', logger())
  }

  const handler = async (c: Context): Promise<Response> => {
    let executionContext: Context['executionCtx'] | {} = {}

    try {
      executionContext = c.executionCtx
    } catch (e) {}

    const response = await yoga.fetch(c.req.raw, c.env, executionContext)

    return c.newResponse(response.body, response)
  }

  return handler
}
