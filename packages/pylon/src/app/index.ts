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

// Compose the plugin middlewares into an onion CHAIN: each middleware's `next`
// runs the following middleware, and the innermost `next` is the real downstream
// handler (the GraphQL route). This lets a middleware WRAP the request — e.g.
// `useDatabase` binds the per-request connection / tenant / principal around
// `next()`, so the binding actually covers resolver execution. (Previously each
// middleware got a no-op `next` and the handler ran afterward, so wrapping had no
// effect.) A middleware that returns without calling `next` still short-circuits.
const pluginsMiddlewareLoader: MiddlewareHandler = (c, next) => {
  const dispatch = (i: number): Promise<void> => {
    const middleware = pluginsMiddleware[i]
    if (!middleware) return Promise.resolve(next())
    return Promise.resolve(middleware(c, () => dispatch(i + 1))) as Promise<void>
  }
  return dispatch(0)
}

app.use(pluginsMiddlewareLoader)
