import {
  createManager,
  deleteInstance,
  Manager,
  ModelCtor,
  QuerySet,
  saveInstance
} from './manager.js'

export class Model {
  /**
   * Custom-manager handle (Django-style). The `@model()` decorator assigns a
   * default at runtime, but to get a *typed* manager declare one explicitly:
   *
   * ```ts
   * class User extends Model {
   *   static objects = manager(User) // -> Manager<User>
   * }
   * ```
   *
   * For everyday queries prefer the typed statics below (`User.create`,
   * `User.filter`, …), which infer the model type with no boilerplate.
   */
  static objects: Manager<any>

  // --- Typed query statics ---------------------------------------------------
  // The `this` parameter binds the concrete subclass, so the model type is
  // inferred automatically (`User.create({...})` → `Promise<User>`).

  static create<T extends Model>(
    this: ModelCtor<T>,
    values: Partial<T>
  ): Promise<T> {
    return createManager(this).create(values)
  }

  static filter<T extends Model>(
    this: ModelCtor<T>,
    conditions: Partial<Record<keyof T, unknown>>
  ): QuerySet<T> {
    return createManager(this).filter(conditions)
  }

  static get<T extends Model>(
    this: ModelCtor<T>,
    conditions?: Partial<Record<keyof T, unknown>>
  ): Promise<T> {
    return createManager(this).get(conditions)
  }

  static all<T extends Model>(this: ModelCtor<T>): Promise<T[]> {
    return createManager(this).all()
  }

  static first<T extends Model>(this: ModelCtor<T>): Promise<T | null> {
    return createManager(this).first()
  }

  static count<T extends Model>(this: ModelCtor<T>): Promise<number> {
    return createManager(this).count()
  }

  static orderBy<T extends Model>(
    this: ModelCtor<T>,
    field: keyof T | `-${string & keyof T}`
  ): QuerySet<T> {
    return createManager(this).orderBy(field)
  }

  // --- Instance persistence --------------------------------------------------

  /** Insert (if new) or update (if loaded) this instance. */
  async save(): Promise<this> {
    await saveInstance(this)
    return this
  }

  async delete(): Promise<void> {
    await deleteInstance(this)
  }
}
