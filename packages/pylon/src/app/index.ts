import {sentry} from '@hono/sentry'
import {Hono, MiddlewareHandler} from 'hono'
import {except} from 'hono/combine'
import {compress} from 'hono/compress'
import {logger} from 'hono/logger'
import {asyncContext, Env} from '../context'
import type {PylonConfig} from '../index'

/**
 * The Pylon application — a `Hono` subclass that is the composition primitive of the
 * framework (routes + a GraphQL fragment + a plugin set + a boot lifecycle). It is
 * INSTANTIABLE (`new Pylon()`) rather than a hidden singleton, so apps can be composed
 * fractally: an app is a smaller Pylon; the root is an app of apps.
 *
 * Per-instance state (`config`, `pluginsMiddleware`) lives on the instance so multiple
 * Pylons don't share global mutable state. The default export `app` is one instance,
 * kept for back-compat — the generated entry + every existing plugin target it today.
 */
export class Pylon extends Hono<Env> {
  /** The resolved config for this instance (set by `executeConfig`). */
  config?: PylonConfig

  /**
   * The plugin middleware chain for THIS instance. `executeConfig` fills it; the
   * onion-chain loader below composes it so a middleware can WRAP `next()` (e.g.
   * `useDatabase` binds the per-request connection/tenant/principal around resolver
   * execution). A middleware that returns without calling `next` short-circuits.
   */
  pluginsMiddleware: MiddlewareHandler[] = []

  constructor() {
    super()

    this.use('*', compress())
    this.use('*', sentry())

    this.use('*', async (c, next) => {
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

    this.use('*', except(['/__pylon/*'], logger()))

    this.use((c, next) => {
      const dispatch = (i: number): Promise<void> => {
        const middleware = this.pluginsMiddleware[i]
        if (!middleware) return Promise.resolve(next())
        return Promise.resolve(
          middleware(c, () => dispatch(i + 1))
        ) as Promise<void>
      }
      return dispatch(0)
    })
  }
}

export const app = new Pylon()

/**
 * Back-compat alias for the default instance's plugin middleware array. Existing
 * imports of `pluginsMiddleware` keep working (it's the same array `app` composes).
 */
export const pluginsMiddleware = app.pluginsMiddleware
