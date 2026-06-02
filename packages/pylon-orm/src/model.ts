import {deleteInstance, Manager, saveInstance} from './manager.js'

export class Model {
  /**
   * Default manager. Assigned per concrete model by the `@model()` decorator;
   * declared here for typing. A custom `static objects = manager(...)` on a
   * subclass overrides it.
   */
  static objects: Manager<any>

  /** Insert (if new) or update (if loaded) this instance. */
  async save(): Promise<this> {
    await saveInstance(this)
    return this
  }

  async delete(): Promise<void> {
    await deleteInstance(this)
  }
}
