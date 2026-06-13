import {Context as HonoContext} from 'hono'
import type {Toucan} from 'toucan-js'
import {AsyncLocalStorage} from 'async_hooks'
import {env} from 'hono/adapter'
import type {GraphQLResolveInfo} from 'graphql'

// Core is AUTH-FREE: it has no `auth`/`AuthState` and never reads `c.get('auth')`.
// Authentication produces a `Principal` in @getcronit/pylon-auth (the identity
// provider binds it via `useIdentity`); authz reads the Principal there. Apps that
// add an auth plugin can still declare their own context vars via module
// augmentation of `Variables`.
export interface Bindings {
  NODE_ENV: string
}

export interface Variables {
  sentry: Toucan
  graphqlResolveInfo?: GraphQLResolveInfo
}

export type Env = {
  Bindings: Bindings
  Variables: Variables
}

export type Context = HonoContext<Env, string, {}>

export const asyncContext = new AsyncLocalStorage<Context>()

export const getContext = () => {
  const ctx = asyncContext.getStore()

  if (!ctx) {
    throw new Error('Context not defined')
  }

  ctx.env = env(ctx)

  return ctx
}

export const setContext = (context: Context) => {
  return asyncContext.enterWith(context)
}
