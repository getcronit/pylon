import {Context as HonoContext} from 'hono'
import {AuthState} from './auth'
import {AsyncLocalStorage} from 'async_hooks'

export type Env = {
  Bindings: {
    NODE_ENV: string
  }
  Variables: {
    auth: AuthState
  }
}

export type Context = HonoContext<Env, string, {}>

export const asyncContext = new AsyncLocalStorage<Context>()

export const getContext = () => {
  const ctx = asyncContext.getStore()

  if (!ctx) {
    throw new Error('Context not defined')
  }

  return ctx
}

export const setContext = (context: Context) => {
  return asyncContext.enterWith(context)
}
