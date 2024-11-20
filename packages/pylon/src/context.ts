import {Context as HonoContext} from 'hono'
import type {Toucan} from 'toucan-js'
import {AuthState} from './auth'
import {AsyncLocalStorage} from 'async_hooks'
import {sendFunctionEvent} from '@getcronit/pylon-telemetry'
import {env} from 'hono/adapter'

export interface Bindings {
  NODE_ENV: string
  AUTH_PROJECT_ID?: string
  AUTH_KEY?: string
  AUTH_ISSUER?: string
}

export interface Variables {
  auth: AuthState
  sentry: Toucan
}

export type Env = {
  Bindings: Bindings
  Variables: Variables
}

export type Context = HonoContext<Env, string, {}>

export const asyncContext = new AsyncLocalStorage<Context>()

export const getContext = () => {
  const start = Date.now()
  const ctx = asyncContext.getStore()

  sendFunctionEvent({
    name: 'getContext',
    duration: Date.now() - start
  }).then(() => {})

  if (!ctx) {
    throw new Error('Context not defined')
  }

  ctx.env = env(ctx)

  return ctx
}

export const setContext = (context: Context) => {
  return asyncContext.enterWith(context)
}
