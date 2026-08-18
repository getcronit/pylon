import type {Env} from './context.js'

export {createPubSub as experimentalCreatePubSub} from 'graphql-yoga'
export {executeConfig, handler} from '../app/pylon-handler.js'
// Split value vs type re-exports: mixing types into a value `export {}` breaks when
// a per-module transpiler loads this file (the project runner via tsx) — types have
// no runtime binding, so `export {Bindings}` fails with "no exported member".
export {asyncContext, getContext, setContext} from './context.js'
export type {Bindings, Context, Env, Variables} from './context.js'
export {getLogger, logger, runWithLogger, getRootLogger, createLogger} from './logger.js'
export type {Logger, LogLevel, LogFields, LogRecord, LogSink, LoggerConfig} from './logger.js'
import type {LoggerConfig} from './logger.js'
export {createDecorator} from './create-decorator.js'
export {ServiceError} from './define-pylon.js'
export {mutation, type UserError} from './mutation.js'
export {getEnv} from './get-env.js'
// Core is auth-free. Authentication + the Principal live in @getcronit/pylon/auth
// (OIDC/Zitadel via @getcronit/pylon/auth/zitadel); authz reads the Principal there.
// The frontend pages battery (usePages + the runtime) lives in @getcronit/pylon/pages.
export {getResolveInfo} from './resolve-info.js'
export {useSentry, type SentryPluginOptions} from '../plugins/use-sentry.js'
export {useNodeServer, type NodeServerOptions} from '../plugins/use-node-server.js'
export {pylonApp as app, Pylon}
export type {Gate, Resolvers, PylonOptions} from '../app/index.js'

import {app as pylonApp, Pylon} from '../app/index.js'

import type {Plugin as YogaPlugin} from 'graphql-yoga'
import {MiddlewareHandler} from 'hono'

/**
 * Bundler-agnostic watch handle a build-contributing plugin returns from `build`.
 * The Supervisor creates it once and drives `rebuild()` on relevant changes,
 * `dispose()` on shutdown. Backed by esbuild today, rolldown later — invisible
 * here. See rfcs/BUILD_DEV_PIPELINE.md.
 */
export interface BuildController {
  rebuild(): Promise<void>
  dispose(): Promise<void>
  /** Optional: abort an in-flight rebuild superseded by a newer change. */
  cancel?(): Promise<void>
}

/**
 * Shared, readonly-to-plugins context passed to every `build` hook. Upstream stage
 * outputs land in `out` as the pipeline advances — a `build` hook runs in the
 * `artifacts` stage, so `out.sdl` / `out.clientDir` are populated by then.
 */
export interface BuildContext {
  readonly mode: 'build' | 'dev'
  readonly root: string
  readonly srcDir: string
  readonly outDir: string
  readonly out: {sdl?: string; clientDir?: string}
}

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
  setup?: (app: Pylon<any>) => Promise<void> | void
  /** The one build-side hook: called ONCE per build; returns a watch handle the
   *  Supervisor drives. Reads upstream stage outputs from `ctx.out`. */
  build?: (ctx: BuildContext) => Promise<BuildController>
}

export type PylonConfig = {
  landingPage?: boolean
  graphiql?: boolean
  /** Per-request access logging. `false` disables the access line; an object configures the
   *  runtime logger (`{level, format, base, redact, sink}` — see `LoggerConfig`). Default: on.
   *  Env `LOG_LEVEL` (e.g. `info,db=debug`) and `PYLON_LOG_FORMAT` override at runtime. */
  logger?: boolean | LoggerConfig
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
