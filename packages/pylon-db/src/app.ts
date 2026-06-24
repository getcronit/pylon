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
import type {Resolvers, PylonOptions, Pylon as PylonClass} from '@getcronit/pylon'
import {model as modelDecorator, type ModelOptions} from './fields.js'
import {recordApp} from './registry.js'
import {defineAppPolicy, type AppPolicy} from './policies.js'
import {defineAbilities, type AbilitiesFn} from './abilities.js'

/** App-level ORM config — the constructor `models` option: `new Pylon({name, models})`. */
export interface AppModelOptions {
  /** Property name of the tenant FK; every model in the app auto-scopes by it. */
  tenant?: string
  /** Deny-by-default for the app's models (a per-model `{secure}` still overrides). */
  secure?: boolean
  /** Explicit cross-app migration dependencies (FK-inferred ones are added too). */
  dependsOn?: string[]
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
  interface Pylon<G extends Resolvers = {}> {
    /** App-bound model decorator — tags the model to THIS app's migration group. */
    model(options?: ModelOptions): ClassDecorator
  }
  interface PylonOptions<G extends Resolvers = {}> {
    /** App-level ORM config (tenant/secure/deps/policy/abilities), applied to every `@app.model()`. */
    models?: AppModelOptions
  }
}

/** App-level cross-cutting abilities, keyed by app instance — the IR-harvest seam. */
const appAbilities = new WeakMap<object, AbilitiesFn>()

/** Read an app's cross-cutting abilities (for `pylon inspect`'s authz harvest). */
export function appAbilitiesOf(app: object): AbilitiesFn | undefined {
  return appAbilities.get(app)
}

function install(Pylon: typeof PylonClass): void {
  const registered = new WeakSet<object>()

  const appName = (app: any): string => {
    const name = app.name ?? app.routePrefix?.replace(/^\/+/, '')
    if (!name) {
      throw new Error(
        '[pylon-db] @app.model() needs the Pylon to have a `name` so migrations can ' +
          'group it — pass `new Pylon({name: "blog"})`.'
      )
    }
    return name
  }

  /** The app's ORM config — the constructor `models` option (the single home). */
  const config = (app: any): AppModelOptions =>
    (app.pylonOptions?.models as AppModelOptions | undefined) ?? {}

  const register = (app: any): string => {
    const name = appName(app)
    if (registered.has(app)) return name
    registered.add(app)
    const opts = config(app)
    recordApp(name, {dependsOn: opts.dependsOn})
    if (opts.policy) defineAppPolicy(name, opts.policy)
    else if (opts.secure) {
      console.warn(
        `[pylon-db] Pylon "${name}" is secure but has no \`policy\` — every read/write ` +
          'without a per-model definePolicy will be DENIED.'
      )
    }
    if (opts.abilities) {
      appAbilities.set(app, opts.abilities) // synchronous: harvestable immediately
      // Defer the rule wiring to a microtask so it runs AFTER every `@app.model()`
      // in the module graph has registered — otherwise a cross-cutting rule that
      // governs a model decorated later wouldn't get its row policy wired.
      queueMicrotask(() => defineAbilities(opts.abilities!))
    }
    return name
  }

  Pylon.prototype.model = function (options: ModelOptions = {}) {
    const name = register(this)
    const opts = config(this)
    return modelDecorator({
      ...options,
      app: name,
      tenant: options.tenant ?? opts.tenant,
      secure: options.secure ?? opts.secure
    })
  }
}

// Register with core's extension bus (no runtime core import). Apply now if core is
// already loaded; otherwise core applies us when it loads.
const EXT = Symbol.for('@getcronit/pylon.extend')
const bus = ((globalThis as any)[EXT] ??= {fns: [], Pylon: undefined})
if (bus.Pylon) install(bus.Pylon)
else bus.fns.push(install)
