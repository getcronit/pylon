/**
 * Queues authored as classes — the model-mirrored form. A queue is a `Queue`
 * subclass with a typed payload and a `process` method; enqueue via a manager
 * assigned to a static, exactly like `static objects = manager(Model)`. Per-queue
 * options (attempts/cron/concurrency/schema) live in `static config`, and the app
 * registers it via the constructor — there is no queue decorator:
 *
 * ```ts
 * class Publish extends Queue<{postId: string}> {
 *   static config = {attempts: 3}
 *   static jobs = manager(Publish)
 *   async process({data}) {
 *     const post = await Post.objects.get({id: data.postId})
 *     post.published = true; await post.$save()
 *   }
 * }
 *
 * export default new Pylon({name: 'blog', queues: [Publish]})
 * await Publish.jobs.dispatch({postId: '1'})
 * ```
 *
 * Under the hood each class is registered as a normal `QueueDefinition`, so the
 * worker runner, outbox, and `startWorkers()` pick it up unchanged.
 */
import {
  defineQueue,
  registerCron,
  type JobContext,
  type QueueDefinition,
  type QueueOptions
} from './queue.js'

/** A schema with a `.parse` (zod, valibot-via-adapter, or any `{parse}`). */
export interface PayloadSchemaLike {
  parse: (input: unknown) => any
}
/** The validated payload type a schema yields. */
export type Parsed<S> = S extends {parse: (input: any) => infer T} ? T : never

/**
 * Base class for a class-defined queue. `Payload` is the job's input type and
 * `Result` the value `dispatch` resolves to. Both are phantom-typed so `manager`
 * can recover them; the only member you implement is `process`.
 *
 * Two ways to type the payload:
 *  - `extends Queue<{postId: string}>` — type-only (no runtime validation).
 *  - `extends Queue.input(schema)` — **schema-first** (RECOMMENDED). The schema is
 *    the single source of truth: the payload type is inferred from it AND it
 *    validates every job at runtime. A queue payload is serialized into Redis and
 *    pulled back by a different (possibly different-version) process, so the compile-
 *    time type guarantees nothing at the worker — the schema is what does.
 */
export abstract class Queue<Payload = void, Result = void> {
  /** @internal phantom — carries the payload type for `manager`. */
  declare readonly __payload: Payload
  /** @internal phantom — carries the result type for `manager`. */
  declare readonly __result: Result
  /** The job handler. `ctx.data` is the typed (and, with `Queue.input`, validated) payload. */
  abstract process(ctx: JobContext<Payload>): Result | Promise<Result>

  /**
   * Schema-first base: `class Publish extends Queue.input(z.object({postId: z.string()}))`.
   * The payload type is inferred from the schema and the schema is attached so registration
   * wires it as the runtime validator — one source of truth.
   */
  static input<S extends PayloadSchemaLike, R = void>(
    schema: S
  ): abstract new () => Queue<Parsed<S>, R> {
    abstract class WithSchema extends Queue<Parsed<S>, R> {
      static readonly schema: S = schema
    }
    return WithSchema as unknown as abstract new () => Queue<Parsed<S>, R>
  }
}

/** Read a schema attached by `Queue.input` (inherited by subclasses), if any. */
function attachedSchema(Ctor: Function): PayloadSchemaLike | undefined {
  return (Ctor as {schema?: PayloadSchemaLike}).schema
}

type PayloadOf<Q> = Q extends Queue<infer P, any> ? P : never
type ResultOf<Q> = Q extends Queue<any, infer R> ? R : never

export interface QueueClassOptions<Payload = any> extends QueueOptions<Payload> {
  /** Override the queue name (defaults to kebab-case of the class name). */
  name?: string
  /** Schedule as a repeatable cron job (e.g. `'0 * * * *'`). The payload is `void`. */
  cron?: string
}

/**
 * Per-queue config for `static config = {…} satisfies QueueConfig<Publish>` — the queue
 * mirror of `ModelConfig<T>`. The `schema` is typed against the queue's own payload, so a
 * mismatched validator is a compile error.
 */
export interface QueueConfig<Q extends Queue<any, any> = Queue>
  extends QueueClassOptions<PayloadOf<Q>> {}

/** Kebab-case a class name: `SendInvoice` → `send-invoice`. */
export function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
}

const defs = new WeakMap<Function, QueueDefinition<any, any>>()

/** Read per-queue options declared on the class (`static config`). */
export function queueConfigOf(Ctor: Function): QueueClassOptions {
  return (Ctor as {config?: QueueClassOptions}).config ?? {}
}

/**
 * Register a queue class → an underlying `QueueDefinition` (idempotent). Called by the
 * app's constructor processor with the fully-qualified queue name; per-queue options
 * come from `static config` (merged here) with any explicit `options` winning.
 */
export function registerQueueClass(
  Ctor: new () => Queue<any, any>,
  fqName: string,
  options: QueueClassOptions = {}
): QueueDefinition<any, any> {
  const existing = defs.get(Ctor)
  if (existing) return existing

  const {name: _name, cron, ...queueOptions} = {...queueConfigOf(Ctor), ...options}
  // A `Queue.input(schema)` base attaches the schema; an explicit `{schema}` option
  // still wins. Either way the queue validates every job at runtime — the guarantee
  // the erased payload type can't give once the job is serialized to Redis.
  const schema = queueOptions.schema ?? attachedSchema(Ctor)
  const instance = new Ctor()
  const def = defineQueue(fqName, {...queueOptions, schema}).process(ctx =>
    instance.process(ctx)
  )
  defs.set(Ctor, def)
  if (cron) registerCron(def as QueueDefinition<void, void>, cron)
  return def
}

/** The `QueueDefinition` a class was registered as (throws if it wasn't registered). */
export function getQueueDefinition(Ctor: Function): QueueDefinition<any, any> {
  const def = defs.get(Ctor)
  if (!def) {
    throw new Error(
      `[pylon-queues] ${(Ctor as {name?: string}).name ?? 'queue'} is not registered — ` +
        'add it to an app: `new Pylon({queues: [' +
        `${(Ctor as {name?: string}).name ?? 'Queue'}]})\`.`
    )
  }
  return def
}

export interface JobManager<Payload, Result> {
  /** Enqueue a job (validated; outbox-routed inside a pylon-db transaction). */
  add(data: Payload): Promise<void>
  /** Enqueue after a delay (ms). */
  addDelayed(data: Payload, delayMs: number): Promise<void>
  /** Enqueue and await the processor's typed result (needs a running worker). */
  dispatch(data: Payload): Promise<Result>
}

/**
 * A typed job handle for a queue class — `static jobs = manager(Publish)`, mirroring a
 * model's `static objects = manager(Post)`. Lazy: it resolves the underlying queue on
 * first use, so the static-field initializer can run before the app registers the class.
 */
export function manager<Q extends Queue<any, any>>(
  Ctor: new () => Q
): JobManager<PayloadOf<Q>, ResultOf<Q>> {
  return {
    add: data => getQueueDefinition(Ctor).add(data),
    addDelayed: (data, delayMs) => getQueueDefinition(Ctor).addDelayed(data, delayMs),
    dispatch: data => getQueueDefinition(Ctor).dispatch(data)
  }
}
