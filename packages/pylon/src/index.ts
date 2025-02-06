import {Env} from './context.js'

export {ServiceError} from './define-pylon.js'
export * from './auth/index.js'
export {
  Context,
  Env,
  Variables,
  Bindings,
  asyncContext,
  getContext,
  setContext
} from './context.js'
import {app as pylonApp} from './app/index.js'
export {pylonApp as app}
export {handler} from './app/pylon-handler.js'
export {getEnv} from './get-env.js'
export {createDecorator} from './create-decorator.js'
export {createPubSub as experimentalCreatePubSub} from 'graphql-yoga'

import type {Plugin as YogaPlugin} from 'graphql-yoga'
import {MiddlewareHandler} from 'hono'

export type Plugin<
  PluginContext extends Record<string, any> = {},
  TServerContext extends Record<string, any> = {},
  TUserContext = {}
> = YogaPlugin<PluginContext, TServerContext, TUserContext> & {
  middleware?: MiddlewareHandler<Env>
  setup?: (app: typeof pylonApp) => void
  build?: () => Promise<void>
}

export type PylonConfig = {
  plugins?: Plugin[]
}

export type ID = string & {readonly brand?: unique symbol}
export type Int = number & {readonly brand?: unique symbol}
export type Float = number & {readonly brand?: unique symbol}
