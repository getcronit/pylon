/**
 * Adds `@app.model()` to the core `Pylon` class so a model binds to its app instance:
 *
 * ```ts
 * const blog = new Pylon({name: 'blog', models: {tenant: 'authorId', secure: true}})
 * @blog.model() class Post extends Model { … }
 * ```
 *
 * App-level ORM config — tenant scoping, deny-by-default, migration deps, and
 * CROSS-CUTTING abilities — is the constructor `models` option (`AppModelOptions`).
 * Per-model rules belong on the model itself (`static abilities`).
 *
 * Auto-loaded from the package entry (importing `@getcronit/pylon-db`, which you do to
 * extend `Model`, enables it). This module does NOT import core at runtime — it
 * registers a prototype-patcher on a shared global that core applies when it loads
 * (the extension bus in core's `app/index.ts`), so `@getcronit/pylon` stays an
 * OPTIONAL peer. The `declare module` below supplies the types (a type-only import).
 */
import path from 'node:path'
import type {Resolvers, PylonOptions} from '@getcronit/pylon'
import {finalizeProxyModel} from './fields.js'
import {enableGlobalIds, recordApp} from './registry.js'
import {defineAppPolicy, type AppPolicy} from './policies.js'
import {defineAbilities, type AbilitiesFn} from './abilities.js'

/**
 * The app's database aspect — the single `db` constructor option (pylon-db owns one key):
 * `new Pylon({name, db: {models: [Post, Comment], tenant, secure, policy}})`. The model
 * classes and the tenant/secure/policy that govern them live together.
 */
export interface AppModelOptions {
  /**
   * The decorator-free model classes this app owns. Each plain `class Post extends Model {…}`
   * is finalized (proxy path), tagged to this app (a NAMED app prefixes the table + forms a
   * migration group), and recorded internally (read via `modelsOf(app)`). The single
   * registration surface.
   */
  models?: Array<new () => any>
  /** Property name of the tenant FK; every model in the app auto-scopes by it. */
  tenant?: string
  /** Deny-by-default for the app's models (a per-model `{secure}` still overrides). */
  secure?: boolean
  /** Explicit cross-app migration dependencies (FK-inferred ones are added too). */
  dependsOn?: string[]
  /**
   * Override for THIS app's migrations directory. Optional — migrations default to
   * `<app-source-dir>/migrations` (zero config, colocated with the app). Set this only
   * for a non-standard location: absolute, or resolved by the CLI relative to the
   * project root. There is no central migrations folder for apps.
   */
  migrations?: string
  /**
   * Opt into Relay-style global object ids for this app's models: every model
   * gains a `gid://pylon/<Type>/<id>` handle, implements a shared `Node`
   * interface, and a root `node(id): Node` refetch field is added. NOTE: this
   * changes the wire shape of every `id` (raw → gid). Project-wide once any
   * composed app enables it (the `Node` interface is a singleton).
   */
  globalIds?: boolean
  /** App-wide fallback policy for any model/action a per-model `definePolicy` omits. */
  policy?: AppPolicy
  /**
   * CROSS-CUTTING resource rules for the app's models (subject explicit, e.g.
   * `can('manage', 'all')` or `can('read', Comment, {…})`). The app-scoped,
   * IR-harvestable home for what a global `defineAbilities` used to do — a model's
   * OWN rules belong in its `static abilities`.
   */
  abilities?: AbilitiesFn
}

declare module '@getcronit/pylon' {
  interface PylonOptions<G extends Resolvers = {}> {
    /** The app's database aspect — models + their ORM config. See {@link AppModelOptions}. */
    db?: AppModelOptions
  }
}

/** App-level cross-cutting abilities, keyed by app instance — the IR-harvest seam. */
const appAbilities = new WeakMap<object, AbilitiesFn>()

/** Read an app's cross-cutting abilities (for `pylon inspect`'s authz harvest). */
export function appAbilitiesOf(app: object): AbilitiesFn | undefined {
  return appAbilities.get(app)
}

const registered = new WeakSet<object>()

/** Private store of the model classes each app owns — read via `modelsOf(app)`. */
const modelStore = new WeakMap<object, Array<new () => any>>()

/**
 * The model classes registered on `app` (via `new Pylon({models: […]})`), including
 * its composed children's — the internal IR-harvest seam (no public `app.models`).
 */
export function modelsOf(app: any): Array<new () => any> {
  const own = modelStore.get(app) ?? []
  const kids: Array<new () => any> = (app.children ?? []).flatMap((c: any) => modelsOf(c))
  return [...own, ...kids]
}

const appName = (app: any): string | undefined =>
  app.name ?? app.routePrefix?.replace(/^\/+/, '')

/** The app's ORM config — the constructor `db` option (the single home). */
const config = (app: any): AppModelOptions =>
  (app.pylonOptions?.db as AppModelOptions | undefined) ?? {}

/** Grouping / policy / cross-cutting abilities for a NAMED app (once). */
const register = (app: any, name: string): void => {
  if (registered.has(app)) return
  registered.add(app)
  const opts = config(app)
  // Migrations default to `<app-source-dir>/migrations`, colocated with the app —
  // zero config. `app.sourceDir` is captured by core from the construction call site
  // (works when the app runs unbundled, i.e. under the project runner). An explicit
  // `db.migrations` always wins.
  const dir =
    opts.migrations ?? (app.sourceDir ? path.join(app.sourceDir, 'migrations') : undefined)
  recordApp(name, {dependsOn: opts.dependsOn, dir})
  if (opts.policy) defineAppPolicy(name, opts.policy)
  else if (opts.secure) {
    console.warn(
      `[pylon-db] Pylon "${name}" is secure but has no \`policy\` — every read/write ` +
        'without a per-model definePolicy will be DENIED.'
    )
  }
  if (opts.abilities) {
    appAbilities.set(app, opts.abilities) // synchronous: harvestable immediately
    // Defer rule wiring to a microtask so it runs AFTER every model in the graph
    // is registered — else a cross-cutting rule over a later model wouldn't wire.
    queueMicrotask(() => defineAbilities(opts.abilities!))
  }
}

/**
 * Construction-time processor for `new Pylon({db: {models: [Post, …]}})` — the only model
 * registration path. A NAMED app prefixes tables + forms a migration group; an UNNAMED root
 * app keeps bare names + the default group. Each model is finalized (proxy path) and recorded
 * in the private `modelStore`.
 */
function processModels(app: any): void {
  const opts = config(app)
  const models = opts.models
  if (!models?.length) return
  const name = appName(app)
  if (name) register(app, name)
  if (opts.globalIds) enableGlobalIds()
  const store = modelStore.get(app) ?? []
  for (const Ctor of models) {
    finalizeProxyModel(Ctor, {app: name, tenant: opts.tenant, secure: opts.secure})
    store.push(Ctor)
  }
  modelStore.set(app, store)
}

// Register the construct hook on core's extension bus (no runtime core import). There is
// no prototype patch any more — model registration is the `db.models` constructor option.
const EXT = Symbol.for('@getcronit/pylon.extend')
const bus = ((globalThis as any)[EXT] ??= {fns: [], constructHooks: [], Pylon: undefined})
bus.constructHooks ??= []
bus.constructHooks.push(processModels)
