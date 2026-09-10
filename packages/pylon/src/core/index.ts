import type {Env} from './context.js'

export {createPubSub as experimentalCreatePubSub} from 'graphql-yoga'
export {executeConfig, handler, currentRole} from '../app/pylon-handler.js'
// Split value vs type re-exports: mixing types into a value `export {}` breaks when
// a per-module transpiler loads this file (the project runner via tsx) — types have
// no runtime binding, so `export {Bindings}` fails with "no exported member".
export {asyncContext, getContext, setContext} from './context.js'
export type {Bindings, Context, Env, Variables} from './context.js'
export {getLogger, logger, runWithLogger, getRootLogger, createLogger} from './logger.js'
// Also exported for the queues battery, which must reach the logger across the feature
// boundary via this self-ref (a relative import would inline a SECOND logger with its own
// async context + config). `renderLine` formats the BullMQ per-job log tee; `jobLogLevel`
// is that tee's threshold from `config.logger.job.level`.
export {renderLine, jobLogLevel} from './logger.js'
export type {Logger, LogLevel, LogFields, LogRecord, LogSink, LoggerConfig} from './logger.js'
import type {LoggerConfig} from './logger.js'
export {createDecorator} from './create-decorator.js'
export {ServiceError} from './define-pylon.js'
export {mutation, type UserError} from './mutation.js'
export {getEnv} from './get-env.js'
// Cookie helpers, re-exported from Hono. An app cannot `import {getCookie} from 'hono/cookie'`
// itself: `hono` is PYLON's dependency, not the app's, so under a strict node_modules layout
// (pnpm) the specifier does not resolve — and under npm's flat hoisting it resolves by
// accident, which is worse. Reading cookies is the primary way `pagesContext` gets populated,
// so the helpers ship here. See rfcs/SSR_REQUEST_CONTEXT.md.
export {getCookie, getSignedCookie, setCookie, setSignedCookie, deleteCookie} from 'hono/cookie'
// Core is auth-free. Authentication + the Principal live in @getcronit/pylon/auth
// (OIDC/Zitadel via @getcronit/pylon/auth/zitadel); authz reads the Principal there.
// The frontend pages battery (usePages + the runtime) lives in @getcronit/pylon/pages.
export {getResolveInfo} from './resolve-info.js'
export {
  getLocale,
  getInContext,
  IN_CONTEXT_SDL,
  type InContext,
  type OperationContext
} from './in-context.js'
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

/**
 * The process run-role, set via `PYLON_ROLE` and read by `executeConfig`:
 *  - `web` (default / unset) — serve HTTP; do not consume queues.
 *  - `worker` — consume queues + drain the outbox; bind no port.
 *  - `all` — do both (dev, or a single-process deploy).
 *
 * A plugin's `roles` is scoped to the concrete `web`/`worker` split (`PluginRole`); `all`
 * is a process mode that runs both sides, never a per-plugin tag.
 */
export type PylonRole = 'web' | 'worker' | 'all'
export type PluginRole = 'web' | 'worker'

export type Plugin<
  PluginContext extends Record<string, any> = {},
  TServerContext extends Record<string, any> = {},
  TUserContext = {}
> = YogaPlugin<PluginContext, TServerContext, TUserContext> & {
  /** Identity — used for dependency ordering and error attribution. */
  name?: string
  /**
   * Which run-roles this plugin participates in. Omitted = every role (back-compat — the
   * default for infra plugins like `useDatabase`/`useIdentity` and any user plugin).
   * `executeConfig` SKIPS a plugin whose `roles` is set and excludes the current role, so a
   * worker never runs — nor imports the deps of — web-only plugins: `usePages` and
   * `useNodeServer` tag themselves `['web']`, keeping React/react-router/manifests and the
   * HTTP listener out of the worker process (and its standalone trace). A plugin that runs
   * everywhere but BEHAVES by role (e.g. `useQueues`: wire the ORM/outbox always, consume
   * only in `worker`/`all`) leaves this unset and reads the role itself.
   */
  roles?: PluginRole[]
  /** `strategy` is the COARSE phase (relative to the GraphQL handler mount):
   *  'first' = before it, 'last' = after it (e.g. `usePages` catch-all routes). */
  strategy?: 'first' | 'last'
  /** Other plugin `name`s this one must load AFTER (within the same phase). A dep
   *  not present in the phase is assumed satisfied by the other phase. Cycles throw. */
  dependsOn?: string[]
  /**
   * The plugin's own options, exposed so tooling can read them.
   *
   * `pylon dev` needs `usePages`'s `i18n` before it stands up the client Vite, and options
   * passed to a factory are otherwise captured in its closure and unreachable.
   */
  options?: Record<string, any>
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

export {createGateway, pass, passthrough} from './gateway.js'
export type {FieldPolicy, PatchPolicy} from './gateway.js'
