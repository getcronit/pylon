import {YogaServerOptions} from 'graphql-yoga'
import {Context, Env} from './context.js'

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
export {app} from './app/index.js'
export {handler} from './app/pylon-handler.js'
export {getEnv} from './get-env.js'
export {createDecorator} from './create-decorator.js'
export {createPubSub as experimentalCreatePubSub} from 'graphql-yoga'
import type {Plugin as YogaPlugin, YogaInitialContext} from 'graphql-yoga'

export type Plugin<
  PluginContext extends Record<string, any> = {},
  TServerContext extends Record<string, any> = {},
  TUserContext = {}
> = YogaPlugin<PluginContext, TServerContext, TUserContext> & {
  middleware?: MiddlewareHandler<Env>
  app?: (app: typeof pylonApp) => void
}

export type PylonConfig = {
  landingPage?: boolean
  plugins?: Plugin[]
}

export type ID = string & {readonly brand?: unique symbol}
export type Int = number & {readonly brand?: unique symbol}
export type Float = number & {readonly brand?: unique symbol}

import {MiddlewareHandler} from 'hono'
import {app} from './app/index.js'

export {useAuth} from './plugins/use-auth.js'
