/**
 * Adds `app.model()` / `app.models()` to the core `Pylon` class so a model binds to
 * its app *instance* —
 *
 * ```ts
 * const blog = new Pylon({name: 'blog', models: {tenant: 'authorId', secure: true}})
 * @blog.model() class Post extends Model { … }
 * ```
 *
 * Auto-loaded from the package entry: importing `@getcronit/pylon-db` (which you do to
 * extend `Model`) enables it. This module does NOT import core at runtime — it
 * registers a prototype-patcher on a shared global that core applies when it loads
 * (see the extension bus in core's `app/index.ts`). That keeps `@getcronit/pylon` an
 * OPTIONAL peer: the migration CLI defines models without pulling in core's web
 * runtime. The `declare module` below supplies the types (a type-only core import).
 */
import type {Resolvers, PylonOptions, Pylon as PylonClass} from '@getcronit/pylon'
import {model as modelDecorator, type ModelOptions} from './fields.js'
import {recordApp} from './registry.js'
import {defineAppPolicy, type AppPolicy} from './policies.js'

/** App-level model defaults — pass via `new Pylon({models})` or `app.models(...)`. */
export interface AppModelOptions {
  /** Property name of the tenant FK; every model in the app auto-scopes by it. */
  tenant?: string
  /** Deny-by-default for the app's models (a per-model `{secure}` still overrides). */
  secure?: boolean
  /** Explicit cross-app migration dependencies (FK-inferred ones are added too). */
  dependsOn?: string[]
  /** App-wide fallback policy for any model/action a per-model `definePolicy` omits. */
  policy?: AppPolicy
}

declare module '@getcronit/pylon' {
  interface Pylon<G extends Resolvers = {}> {
    /** Configure app-level model defaults and register the migration group. Chainable. */
    models(options?: AppModelOptions): this
    /** App-bound model decorator — tags the model to THIS app's migration group. */
    model(options?: ModelOptions): ClassDecorator
  }
  interface PylonOptions<G extends Resolvers = {}> {
    /** App-level ORM config, applied to every `app.model()` — the constructor-injected form. */
    models?: AppModelOptions
  }
}

/** Patch `Pylon.prototype`. Called by core's extension bus with the class — no core import. */
function install(Pylon: typeof PylonClass): void {
  const overrides = new WeakMap<object, AppModelOptions>()
  const registered = new WeakSet<object>()

  const appName = (app: any): string => {
    const name = app.name ?? app.routePrefix?.replace(/^\/+/, '')
    if (!name) {
      throw new Error(
        "[pylon-db] app.model() needs the Pylon to have a `name` so migrations can " +
          'group it. Pass `new Pylon({name: "blog"})`, or use `models.app("blog")`.'
      )
    }
    return name
  }

  // Constructor-injected `{models}` is the base; `app.models(...)` overrides it.
  const resolved = (app: any): AppModelOptions => ({
    ...(app.pylonOptions?.models as AppModelOptions | undefined),
    ...overrides.get(app)
  })

  const register = (app: any): string => {
    const name = appName(app)
    if (registered.has(app)) return name
    registered.add(app)
    const opts = resolved(app)
    recordApp(name, {dependsOn: opts.dependsOn})
    if (opts.policy) defineAppPolicy(name, opts.policy)
    else if (opts.secure) {
      console.warn(
        `[pylon-db] Pylon "${name}" is secure but has no \`policy\` — every read/write ` +
          'without a per-model definePolicy will be DENIED.'
      )
    }
    return name
  }

  Pylon.prototype.models = function (options: AppModelOptions = {}) {
    overrides.set(this, {...overrides.get(this), ...options})
    registered.delete(this) // re-apply policy/deps with the merged options
    register(this)
    return this
  }

  Pylon.prototype.model = function (options: ModelOptions = {}) {
    const name = register(this)
    const opts = resolved(this)
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
