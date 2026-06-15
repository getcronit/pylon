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
export {ServiceError} from './define-pylon.js'
export {mutation, type UserError} from './mutation.js'
export {getEnv} from './get-env.js'
// Core is auth-free. Authentication + the Principal live in @getcronit/pylon-auth
// (OIDC/Zitadel via @getcronit/pylon-auth/zitadel); authz reads the Principal there.
// The frontend pages battery (usePages + the runtime) lives in @getcronit/pylon-pages.
export {getResolveInfo} from './resolve-info.js'
export {pylonApp as app, Pylon}

import {app as pylonApp, Pylon} from './app/index.js'

import {BuildContext, BuildOptions} from 'esbuild'
import type {Plugin as YogaPlugin} from 'graphql-yoga'
import {MiddlewareHandler} from 'hono'

export type Plugin<
  PluginContext extends Record<string, any> = {},
  TServerContext extends Record<string, any> = {},
  TUserContext = {}
> = YogaPlugin<PluginContext, TServerContext, TUserContext> & {
  /** Identity — used for dependency ordering and error attribution. */
  name?: string
  /** `strategy` is the COARSE phase (relative to the GraphQL handler mount):
   *  'first' = before it, 'last' = after it (e.g. `usePages` catch-all routes). */
  strategy?: 'first' | 'last'
  /** Other plugin `name`s this one must load AFTER (within the same phase). A dep
   *  not present in the phase is assumed satisfied by the other phase. Cycles throw. */
  dependsOn?: string[]
  middleware?: MiddlewareHandler<Env>
  setup?: (app: Pylon) => Promise<void> | void
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
