import {deleteInstance, Manager, saveInstance} from './manager.js'

export class Model {
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
