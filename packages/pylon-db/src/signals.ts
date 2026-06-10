/**
 * Model signals — Django-style, decoupled write lifecycle hooks. Far cleaner than
 * Prisma's per-model-per-operation `$extends` query wrappers: a publisher/subscriber
 * dispatcher you `connect()` receivers to, per-model or globally, with a `created`
 * flag and TYPED instances.
 *
 *   signals.postSave.connect(User, ({instance, created}) => { ... })  // typed: instance is User
 *   signals.postSave.connect(({instance, model, created}) => { ... }) // every model
 *   const off = signals.preDelete.connect(Order, ({instance}) => { ... })  // off() to disconnect
 *
 * Signals fire from instance writes (`.create()`, `$save`, `deleteInstance`) inside
 * the active transaction, so a receiver's own writes (e.g. an audit row) commit or
 * roll back atomically, and it can read the ambient tenant/context for the actor.
 *
 * Like Django, BULK queryset ops (`QuerySet.update()/.delete()`) do NOT fire signals
 * — they're set-based and never load instances. Use instance writes for audited paths.
 */

export interface SaveSignalPayload<T = unknown> {
  instance: T
  /** true on INSERT, false on UPDATE. */
  created: boolean
  model: Function
}

export interface DeleteSignalPayload<T = unknown> {
  instance: T
  model: Function
}

type Receiver<P> = (payload: P) => void | Promise<void>
type ModelCtor<T> = {new (): T}

class Signal<P extends {model: Function; instance: unknown}> {
  private readonly global = new Set<Receiver<P>>()
  private readonly byModel = new Map<Function, Set<Receiver<P>>>()

  /** Subscribe to every model. Returns a disconnect function. */
  connect(receiver: Receiver<P>): () => void
  /** Subscribe to one model (instance is typed). Returns a disconnect function. */
  connect<T extends object>(
    model: ModelCtor<T>,
    receiver: Receiver<Omit<P, 'instance'> & {instance: T}>
  ): () => void
  connect(a: ModelCtor<any> | Receiver<P>, b?: Receiver<any>): () => void {
    if (typeof b === 'function') {
      const model = a as ModelCtor<any>
      const set = this.byModel.get(model) ?? new Set()
      set.add(b as Receiver<P>)
      this.byModel.set(model, set)
      return () => set.delete(b as Receiver<P>)
    }
    const receiver = a as Receiver<P>
    this.global.add(receiver)
    return () => this.global.delete(receiver)
  }

  /** Internal: dispatch to model-scoped then global receivers, in order, awaited. */
  async emit(payload: P): Promise<void> {
    for (const r of this.byModel.get(payload.model) ?? []) await r(payload)
    for (const r of this.global) await r(payload)
  }
}

export const signals = {
  /** Before an INSERT or UPDATE (after validation). Throwing vetoes the write. */
  preSave: new Signal<SaveSignalPayload>(),
  /** After an INSERT or UPDATE (instance reflects DB-generated values). */
  postSave: new Signal<SaveSignalPayload>(),
  /** Before a delete. */
  preDelete: new Signal<DeleteSignalPayload>(),
  /** After a delete. */
  postDelete: new Signal<DeleteSignalPayload>()
} as const
