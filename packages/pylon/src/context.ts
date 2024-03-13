import {Context as HonoContext} from 'hono'
import {AuthState} from './auth'

export type Env = {
  Bindings: {
    NODE_ENV: string
  }
  Variables: {
    auth: AuthState
  }
}

export type Context = HonoContext<Env, string, {}>
