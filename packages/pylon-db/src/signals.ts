/**
 * Model signals — Django-style, decoupled write lifecycle hooks. Far cleaner than
 * Prisma's per-model-per-operation `$extends` query wrappers: a publisher/subscriber
 * dispatcher you `connect()` receivers to, per-model or globally, with a `created`
 * flag and TYPED instances.
 *
 *   signals.postSave.connect(User, ({instances, created}) => { ... })  // typed: instances is User[]
 *   signals.postSave.connect(({instances, model, created}) => { ... }) // every model
 *   const off = signals.preDelete.connect(Order, ({instances}) => { ... })  // off() to disconnect
 *
 * A signal carries the SET of rows the operation touched: a single `.create()`/
 * `$save`/`$delete` fires once with a 1-element `instances` array; `.createMany()`/
 * relation `.set()` fire once with all of them. So handlers iterate (and stay
 * bulk-correct — e.g. an audit handler does one `Activity.objects.createMany(...)`).
 *
 * Signals fire inside the active transaction, so a receiver's own writes (e.g. an
 * audit row) commit or roll back atomically, and it can read the ambient
 * tenant/context for the actor.
 *
 * For side effects that must run only AFTER the write is durable — and must not be
 * able to roll it back — connect with `{afterCommit: true}`; the receiver is deferred
 * (via `onCommit`) until the transaction commits, and its errors are isolated:
 *
 *   signals.postSave.connect(({instances}) => publishChange(...), {afterCommit: true})
 *
 * Like Django, set-based `QuerySet.update()/.delete()` do NOT fire signals — they
 * never load instances. Bulk instance ops (`createMany`, relation `.set()`) DO,
 * unless called with `{signals: false}` (raw seed/import throughput).
 */

import {onCommit} from './database.js'

export interface SaveSignalPayload<T = unknown> {
  /** The rows written (1-element for a single create/save). */
  instances: T[]
  /** true on INSERT, false on UPDATE (homogeneous for the batch). */
  created: boolean
  model: Function
}

export interface DeleteSignalPayload<T = unknown> {
  /** The rows deleted (1-element for a single delete). */
  instances: T[]
  model: Function
}

// The return is awaited then DISCARDED, so allow any value — a concise async
// handler (e.g. `({instances}) => Audit.objects.createMany(...)`) need not be
// `Promise<void>`. `void` keeps sync no-return handlers ergonomic.
type Receiver<P> = (payload: P) => void | Promise<unknown>
type ModelCtor<T> = {new (): T}

export interface ConnectOptions {
  /**
   * Run the receiver AFTER the transaction commits (and OUTSIDE it) rather than
   * inline within it. For side effects that must not run on rollback and must never
   * veto or break the write: realtime pokes, cache invalidation, webhooks, external
   * notifications. Errors are isolated (a committed write can't be undone); with no
   * open transaction the write already autocommitted, so the receiver runs on the
   * next microtask.
   *
   * Default (false): fire inside the transaction, so a receiver's own ORM writes
   * (e.g. an audit row) commit or roll back atomically with the triggering write.
   */
  afterCommit?: boolean
}

type Entry<P> = {receiver: Receiver<P>; afterCommit: boolean}

class Signal<P extends {model: Function; instances: unknown[]}> {
  private readonly global = new Set<Entry<P>>()
  private readonly byModel = new Map<Function, Set<Entry<P>>>()

  /** Subscribe to every model. Returns a disconnect function. */
  connect(receiver: Receiver<P>, options?: ConnectOptions): () => void
  /** Subscribe to one model (instances are typed). Returns a disconnect function. */
  connect<T extends object>(
    model: ModelCtor<T>,
    receiver: Receiver<Omit<P, 'instances'> & {instances: T[]}>,
    options?: ConnectOptions
  ): () => void
  connect(
    a: ModelCtor<any> | Receiver<P>,
    b?: Receiver<any> | ConnectOptions,
    c?: ConnectOptions
  ): () => void {
    if (typeof b === 'function') {
      const model = a as ModelCtor<any>
      const entry: Entry<P> = {
        receiver: b as Receiver<P>,
        afterCommit: c?.afterCommit === true
      }
      const set = this.byModel.get(model) ?? new Set<Entry<P>>()
      set.add(entry)
      this.byModel.set(model, set)
      return () => set.delete(entry)
    }
    const entry: Entry<P> = {
      receiver: a as Receiver<P>,
      afterCommit: (b as ConnectOptions | undefined)?.afterCommit === true
    }
    this.global.add(entry)
    return () => this.global.delete(entry)
  }

  /**
   * Internal: dispatch to model-scoped then global receivers, in order. Inline
   * receivers are awaited within the transaction; `afterCommit` receivers are
   * deferred (each as its own isolated `onCommit`) until the transaction commits.
   */
  async emit(payload: P): Promise<void> {
    if (payload.instances.length === 0) return
    const entries = [
      ...(this.byModel.get(payload.model) ?? []),
      ...this.global
    ]
    for (const {receiver, afterCommit} of entries) {
      if (afterCommit) onCommit(() => receiver(payload))
      else await receiver(payload)
    }
  }
}

export const signals = {
  /** Before an INSERT or UPDATE (after validation). Throwing vetoes the write. */
  preSave: new Signal<SaveSignalPayload>(),
  /** After an INSERT or UPDATE (instances reflect DB-generated values). */
  postSave: new Signal<SaveSignalPayload>(),
  /** Before a delete. */
  preDelete: new Signal<DeleteSignalPayload>(),
  /** After a delete. */
  postDelete: new Signal<DeleteSignalPayload>()
} as const
