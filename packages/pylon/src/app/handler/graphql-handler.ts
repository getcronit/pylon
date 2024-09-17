import {createSchema, createYoga} from 'graphql-yoga'
import {GraphQLScalarType, Kind} from 'graphql'

import {useSentry} from '../envelop/use-sentry'
import {Context} from '../../context'
import {resolversToGraphQLResolvers} from '../../define-pylon'

export interface SchemaOptions {
  typeDefs: string
  resolvers: {
    Query: Record<string, any>
    Mutation: Record<string, any>
  }
}

export const graphqlHandler =
  (c: Context) =>
  ({typeDefs, resolvers}: SchemaOptions) => {
    // Remove empty resolvers
    for (const key in resolvers) {
      if (Object.keys(resolvers[key]).length === 0) {
        delete resolvers[key]
      }
    }

    resolvers = resolversToGraphQLResolvers(resolvers)

    const schema = createSchema({
      typeDefs,
      resolvers: {
        ...resolvers,
        // Transforms a date object to a timestamp
        Date: new GraphQLScalarType({
          name: 'Date',
          description: 'Date custom scalar type',
          parseValue(value) {
            if (typeof value === 'string') {
              return new Date(value)
            }

            if (value instanceof Date) {
              return value // value from the client
            }

            throw Error(
              'GraphQL Date Scalar parseValue expected a `Date` or string'
            )
          },
          serialize(value) {
            if (value instanceof Date) {
              return value.toISOString() // value sent to the client
            }

            throw Error(
              'GraphQL Date Scalar serializer expected a `Date` object'
            )
          },
          parseLiteral(ast) {
            if (ast.kind === Kind.INT) {
              return new Date(parseInt(ast.value, 10))
            } else if (ast.kind === Kind.STRING) {
              return new Date(ast.value)
            }

            return null
          }
        })
      }
    })

    const yoga = createYoga({
      schema: schema as any,
      landingPage: false,
      plugins: [useSentry()],
      graphiql: req => {
        return {
          shouldPersistHeaders: true,
          title: 'Pylon Playground',
          defaultQuery: `# Welcome to the Pylon Playground!`
        }
      },
      context: c
    })

    return yoga
  }