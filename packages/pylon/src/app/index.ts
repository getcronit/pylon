import {sentry} from '@hono/sentry'
import {Hono} from 'hono'

import {asyncContext, Env} from '../context'

export const app = new Hono<Env>()

app.use('*', sentry())

app.use('*', async (c, next) => {
  return new Promise((resolve, reject) => {
    asyncContext.run(c, async () => {
      try {
        resolve(await next()) // You can pass the value you want to return here
      } catch (error) {
        reject(error) // If an error occurs during the execution of `next()`, reject the Promise
      }
    })
  })
})

app.use((c, next) => {
  // @ts-ignore
  c.req.id = crypto.randomUUID()
  return next()
})
