/**
 * Adds `app.queue()` to the core `Pylon` class — the app-bound queue-class decorator:
 *
 * ```ts
 * const blog = new Pylon({name: 'blog'})
 *
 * @blog.queue({attempts: 3})
 * class Publish extends Queue<{postId: string}> {
 *   static jobs = manager(Publish)
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
import type {Resolvers} from '@getcronit/pylon'
import type {QueueDefinition} from './queue.js'
import {
  kebab,
  queueConfigOf,
  registerQueueClass,
  type QueueClassOptions,
  type Queue
} from './queue-class.js'

const appQueues = new WeakMap<object, Set<QueueDefinition<any, any>>>()

/** The `QueueDefinition`s bound to a given app — the IR-harvest seam (no public `app.queues`). */
export function queuesOf(app: object): QueueDefinition<unknown, unknown>[] {
  return [...(appQueues.get(app) ?? [])] as QueueDefinition<unknown, unknown>[]
}

declare module '@getcronit/pylon' {
  interface PylonOptions<G extends Resolvers = {}> {
    /**
     * The queue classes this app owns — `new Pylon({queues: [Publish, Reindex]})`. Each
     * `class Publish extends Queue<…>` is registered, namespaced by the app name
     * (`blog:publish`), and recorded internally (read via `queuesOf(app)`).
     */
    queues?: Array<new () => Queue<any, any>>
  }
}

/** Register one queue class on an app (namespaced by app name), recording it privately. */
function registerQueueOn(
  app: {name?: string},
  Ctor: new () => Queue<any, any>,
  options: QueueClassOptions = {}
): void {
  // A self-referential queue (`static jobs = manager(Reindex)`) compiles, under
  // `useDefineForClassFields:false`, to `var Reindex = class _Reindex {…}` — so
  // `Ctor.name` is the esbuild inner name `_Reindex`. Strip that single leading
  // underscore so the kebab name stays clean (`reindex`, not `-reindex`).
  const className = (Ctor as {name: string}).name.replace(/^_(?=[A-Za-z])/, '')
  const base = options.name ?? queueConfigOf(Ctor).name ?? kebab(className)
  const fqName = (app.name ? `${app.name}:` : '') + base
  const def = registerQueueClass(Ctor, fqName, options)
  const set = appQueues.get(app) ?? new Set<QueueDefinition<any, any>>()
  set.add(def)
  appQueues.set(app, set)
}

/** Construction-time processor for `new Pylon({queues: [Publish, …]})`. */
function processQueues(app: any): void {
  const queues = app.pylonOptions?.queues as Array<new () => Queue<any, any>> | undefined
  if (!queues?.length) return
  for (const Ctor of queues) registerQueueOn(app, Ctor)
}

// Register the construct hook on core's extension bus (no runtime core import). No
// prototype patch — queue registration is the `queues: […]` constructor option.
const EXT = Symbol.for('@getcronit/pylon.extend')
const bus = ((globalThis as any)[EXT] ??= {fns: [], constructHooks: [], Pylon: undefined})
bus.constructHooks ??= []
bus.constructHooks.push(processQueues)
