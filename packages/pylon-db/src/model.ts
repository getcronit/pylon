import {deleteInstance, Manager, saveInstance} from './manager.js'
import {modelHandler} from './fields.js'

export class Model {
  /**
   * Every model is constructed as a Proxy: the `defineProperty`/`set` traps swallow the
   * field-init builders (`id = id()`) and route column reads/writes through a per-instance
   * store — no `Wrapped` subclass, same class identity. The model's schema is harvested
   * once at registration (`new Pylon({db: {models: […]}})` → finalizeProxyModel). See
   * fields.ts for the handler.
   */
  constructor() {
    return new Proxy(this, modelHandler)
  }

  /**
   * The model's manager — the single entry point for queries (Django-style):
   *
   * ```ts
   * await User.objects.create({email: 'a@b.c'})
   * await User.objects.filter({isActive: true}).all()
   * const ada = await User.objects.get({email: 'a@b.c'})
   * ```
   *
   * The `@model()` decorator assigns a working manager at runtime with no
   * boilerplate, but it's typed `Manager<any>`. To get a *typed* manager
   * (`Manager<User>`), declare one explicitly — TypeScript can't infer the
   * instance type for an inherited static property:
   *
   * ```ts
   * class User extends Model {
   *   static objects = db.manager(User) // -> Manager<User>
   * }
   * ```
   */
  static objects: Manager<any>

  // --- Instance persistence --------------------------------------------------
  // Prefixed with `$` so they are excluded from the generated GraphQL schema
  // (`$` is not a valid GraphQL field-name character). Without this, returning a
  // model from a resolver would expose `save`/`delete` as fields — letting a
  // client trigger a write through a query.

  /** Insert (if new) or update (if loaded) this instance. */
  async $save(): Promise<this> {
    await saveInstance(this)
    return this
  }

  async $delete(): Promise<void> {
    await deleteInstance(this)
  }
}
