import {createSchema, createYoga} from 'graphql-yoga'
import {GraphQLScalarType, Kind} from 'graphql'
import {Context} from '@getcronit/pylon'

import {BuildSchemaOptions} from '../make-app'
import {useSentry} from '../envelop/use-sentry'

export const graphqlHandler =
  (c: Context) =>
  ({typeDefs, resolvers}: BuildSchemaOptions) => {
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
      plugins: [
        useSentry()
        // useLogger({
        //   logFn: (eventName, args) => {
        //     // Event could be execute-start / execute-end / subscribe-start / subscribe-end / etc.
        //     // args will include the arguments passed to execute/subscribe (in case of "start" event) and additional result in case of "end" event.
        //     // Only log useful args
        //     if (eventName === 'execute-start') {
        //       const {query, variables} = args
        //       // print args to file
        //       console.log('query', query)
        //       console.log('variables', variables)
        //     }
        //     if (eventName === 'execute-end') {
        //       const {query, variables, result} = args
        //       console.log('query', query)
        //       console.log('variables', variables)
        //       console.log('result', result)
        //     }
        //   }
        // })
      ],
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
