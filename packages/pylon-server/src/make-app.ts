import {graphqlViewerHandler} from './handler/graphql-viewer-handler'
import {graphqlHandler} from './handler/graphql-handler'
import * as crypto from 'crypto'

import {Hono} from 'hono'
import {logger} from 'hono/logger'
import {secureHeaders} from 'hono/secure-headers'

import {sentry} from '@hono/sentry'

export interface BuildSchemaOptions {
  typeDefs: string
  resolvers: {
    Query: Record<string, any>
    Mutation: Record<string, any>
  }
}

interface MakeServerSetupOptions {
  schema: BuildSchemaOptions
  configureApp: (app: Hono) => Hono | void | Promise<void> | Promise<Hono>
}

const makeApp = async (options: MakeServerSetupOptions) => {
  const app = new Hono<{
    Bindings: {
      NODE_ENV: string
    }
  }>()

  if (options.configureApp) {
    await options.configureApp(app as any)
  }

  app.use('*', logger())

  app.use(
    '*',
    sentry({
      environment: process.env.NODE_ENV
    })
  )

  // unique id to identify the request
  app.use((c, next) => {
    // @ts-ignore
    c.req.id = crypto.randomUUID()
    return next()
  })

  app.use('/graphql', async c => {
    let exCtx: typeof c.executionCtx | undefined = undefined

    try {
      exCtx = c.executionCtx
    } catch (e) {}

    return graphqlHandler(c)(options.schema).fetch(
      c.req.raw,
      c.env,
      exCtx || {}
    )
  })

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          'cdn.jsdelivr.net'
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
        // for js worker
        connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        workerSrc: ["'self'", 'blob:']
      },
      xFrameOptions: 'SAMEORIGIN'
    })
  )

  app.get('/viewer', graphqlViewerHandler)

  return app
}

export default makeApp
