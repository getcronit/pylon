import {createSchema, createYoga} from 'graphql-yoga'
import {GraphQLScalarType, Kind} from 'graphql'
import {
  DateTimeISOResolver,
  GraphQLVoid,
  JSONObjectResolver,
  JSONResolver
} from 'graphql-scalars'

import {useSentry} from '../envelop/use-sentry'
import {Context} from '../../context'
import {resolversToGraphQLResolvers} from '../../define-pylon'
import {PylonConfig} from '../..'
import {readFileSync} from 'fs'
import path from 'path'

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

  const yoga = createYoga({
    landingPage: false,
    graphiql: req => {
      return {
        shouldPersistHeaders: true,
        title: 'Pylon Playground',
        defaultQuery: `# Welcome to the Pylon Playground!`
      }
    },
    graphqlEndpoint: '/graphql',
    ...config,
    plugins: [useSentry(), ...(config?.plugins || [])],
    schema
  })

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
