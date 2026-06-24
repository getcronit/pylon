/**
 * Adds `app.queue()` to the core `Pylon` class — the app-bound queue-class decorator:
 *
 * ```ts
 * const blog = new Pylon({name: 'blog'})
 *
 * @blog.queue({attempts: 3})
 * class Publish extends Queue<{postId: string}> {
 *   static jobs = enqueuer(Publish)
 *   async process({data}) { … }
 * }
 * ```
 *
 * The queue name is namespaced by the app (`blog:publish`) and the class's
 * `QueueDefinition` is tracked per app (`queuesOf(app)`) for per-app IR harvest.
 * Auto-loaded from the package entry; registers a prototype-patcher on core's
 * extension bus rather than importing core, so `@getcronit/pylon` stays an optional
 * peer.
 */
import type {Resolvers, Pylon as PylonClass} from '@getcronit/pylon'
import type {QueueDefinition} from './queue.js'
import {kebab, registerQueueClass, type QueueClassOptions, type Queue} from './queue-class.js'

const appQueues = new WeakMap<object, Set<QueueDefinition<any, any>>>()

/** The `QueueDefinition`s bound to a given app via `app.queue(...)` — the IR-harvest seam. */
export function queuesOf(app: object): QueueDefinition<unknown, unknown>[] {
  return [...(appQueues.get(app) ?? [])] as QueueDefinition<unknown, unknown>[]
}

declare module '@getcronit/pylon' {
  interface Pylon<G extends Resolvers = {}> {
    /** App-bound queue-class decorator — registers the `Queue` subclass, namespaced by the app. */
    queue(options?: QueueClassOptions): ClassDecorator
  }
}

function install(Pylon: typeof PylonClass): void {
  Pylon.prototype.queue = function (options: QueueClassOptions = {}): ClassDecorator {
    const app = this as {name?: string}
    return ((Ctor: new () => Queue<any, any>) => {
      const base = options.name ?? kebab((Ctor as {name: string}).name)
      const fqName = (app.name ? `${app.name}:` : '') + base
      const def = registerQueueClass(Ctor, fqName, options)
      const set = appQueues.get(app) ?? new Set<QueueDefinition<any, any>>()
      set.add(def)
      appQueues.set(app, set)
      return Ctor
    }) as ClassDecorator
  }
}

const EXT = Symbol.for('@getcronit/pylon.extend')
const bus = ((globalThis as any)[EXT] ??= {fns: [], Pylon: undefined})
if (bus.Pylon) install(bus.Pylon)
else bus.fns.push(install)
