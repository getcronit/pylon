import {Env} from './context.js'

export {createPubSub as experimentalCreatePubSub} from 'graphql-yoga'
export {executeConfig, handler} from './app/pylon-handler.js'
export {
  asyncContext,
  Bindings,
  Context,
  Env,
  getContext,
  setContext,
  Variables
} from './context.js'
export {createDecorator} from './create-decorator.js'
export {getResolveInfo, ServiceError} from './define-pylon.js'
export {getEnv} from './get-env.js'
export {authMiddleware, requireAuth, useAuth} from './plugins/use-auth/index.js'
export {usePages} from './plugins/use-pages'
export {pylonApp as app}

import {app as pylonApp} from './app/index.js'

import {BuildContext, BuildOptions} from 'esbuild'
import type {Plugin as YogaPlugin} from 'graphql-yoga'
import {MiddlewareHandler} from 'hono'

export type Plugin<
  PluginContext extends Record<string, any> = {},
  TServerContext extends Record<string, any> = {},
  TUserContext = {}
> = YogaPlugin<PluginContext, TServerContext, TUserContext> & {
  strategy?: 'first' | 'last'
  middleware?: MiddlewareHandler<Env>
  setup?: (app: typeof pylonApp) => Promise<void> | void
  build?: <T extends BuildOptions>(args: {
    onBuild: () => void
  }) => Promise<Omit<BuildContext<T>, 'serve'>>
}

export type PylonConfig = {
  landingPage?: boolean
  graphiql?: boolean
  plugins?: Plugin[]
}

export type ID = string & {readonly brand?: unique symbol}
export type Int = number & {readonly brand?: unique symbol}
export type Float = number & {readonly brand?: unique symbol}

export {createGateway} from './gateway.js'
