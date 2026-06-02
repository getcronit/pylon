import {sentry} from '@hono/sentry'
import {Hono, MiddlewareHandler, Next} from 'hono'
import {except} from 'hono/combine'
import {compress} from 'hono/compress'
import {logger} from 'hono/logger'
import {asyncContext, Context, Env} from '../context'

export const app = new Hono<Env>()

app.use('*', compress())

app.use('*', sentry())

app.use('*', async (c, next) => {
  return new Promise((resolve, reject) => {
    asyncContext.run(c, async () => {
      try {
        resolve(await next())
      } catch (error) {
        reject(error)
      }
    })
  })
})

app.use('*', except(['/__pylon/*'], logger()))

export const pluginsMiddleware: MiddlewareHandler[] = []

const pluginsMiddlewareLoader: MiddlewareHandler = async (c, next) => {
  for (const middleware of pluginsMiddleware) {
    const response = await middleware(c, async () => {})

    if (response) {
      return response
    }
  }

  return next()
}

app.use(pluginsMiddlewareLoader)
