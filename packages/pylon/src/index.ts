import {Env} from './context.js'

export {ServiceError} from './define-pylon.js'
export {useAuth, requireAuth, authMiddleware} from './plugins/use-auth/index.js'
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

export {usePages} from './plugins/use-pages'

import type {Plugin as YogaPlugin} from 'graphql-yoga'
import {MiddlewareHandler} from 'hono'
import {BuildContext, BuildOptions} from 'esbuild'

export type Plugin<
  PluginContext extends Record<string, any> = {},
  TServerContext extends Record<string, any> = {},
  TUserContext = {}
> = YogaPlugin<PluginContext, TServerContext, TUserContext> & {
  middleware?: MiddlewareHandler<Env>
  setup?: (app: typeof pylonApp) => void
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
