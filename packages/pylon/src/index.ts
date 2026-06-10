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
export {defineApp, createApp, type AppDefinition, type AppGraphql} from './apps.js'
export {ServiceError} from './define-pylon.js'
export {getEnv} from './get-env.js'
export {authMiddleware, requireAuth, useAuth} from './plugins/use-auth/index.js'
export {usePages} from './plugins/use-pages/index.js'
export {getResolveInfo} from './resolve-info.js'
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

/** A lazy config factory — may be async (e.g. to read env at eval time). */
export type PylonConfigFactory = () => PylonConfig | Promise<PylonConfig>

/**
 * Define the Pylon config in a standalone `pylon.config.ts`. For static config,
 * `satisfies PylonConfig` is just as good (and keeps the file dependency-free):
 *
 * ```ts
 * export default { graphiql: true } satisfies PylonConfig
 * ```
 *
 * Reach for `defineConfig` when you need a lazy/async factory — the one thing a
 * type annotation can't express:
 *
 * ```ts
 * import {defineConfig} from '@getcronit/pylon'
 * export default defineConfig(async () => ({ graphiql: process.env.DEV === '1' }))
 * ```
 *
 * Identity at runtime; the loader resolves a factory before use.
 */
export function defineConfig(
  config: PylonConfig | PylonConfigFactory
): PylonConfig | PylonConfigFactory {
  return config
}

export type ID = string & {readonly brand?: unique symbol}
export type Int = number & {readonly brand?: unique symbol}
export type Float = number & {readonly brand?: unique symbol}

export {createGateway} from './gateway.js'
