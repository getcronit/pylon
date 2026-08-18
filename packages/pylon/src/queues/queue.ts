/**
 * Typed queues over BullMQ. Define a queue with a payload schema + defaults;
 * enqueue from anywhere (resolvers, services, signals); process in the worker.
 *
 *   const emailSend = defineQueue('email-send', {
 *     schema: z.object({ticketId: z.string()}),
 *     attempts: 3, backoff: {type: 'exponential', delay: 1000}, concurrency: 5,
 *   })
 *   await emailSend.add({ticketId})              // enqueue
 *   emailSend.process(async ({data, ctx}) => …)  // worker (in `pylon worker`)
 */
import {Queue as BullQueue, QueueEvents, Worker, type Job, type JobsOptions} from 'bullmq'
import {getConnection} from './connection.js'
import {getOutboxDriver} from './outbox.js'
import {getRootLogger, jobLogLevel, renderLine, runWithLogger} from '../core/logger.js'

/** Anything with a synchronous `.parse()` (Zod/Valibot/ArkType, …). Optional. */
export interface PayloadSchema<T> {
  parse(data: unknown): T
}

export interface QueueOptions<T> {
  /** Validate job data on enqueue + before processing. */
  schema?: PayloadSchema<T>
  /** Retry attempts (default 1 = no retry). */
  attempts?: number
  backoff?: {type: 'exponential' | 'fixed'; delay: number}
  /** Worker concurrency (default 1). */
  concurrency?: number
  removeOnComplete?: number | boolean | {count?: number; age?: number}
  removeOnFail?: number | boolean | {count?: number; age?: number}
}

/** Context handed to a processor for each job. */
export interface JobContext<T> {
  data: T
  job: Job<T>
  log(message: string): Promise<void>
}

export type Processor<T, R = void> = (ctx: JobContext<T>) => R | Promise<R>

const registry = new Map<string, QueueDefinition<any, any>>()

// A wrapper run around every job (set by useQueues to bind the ORM connection /
// tenant). Default: run the handler directly. Result-preserving (its return value
// becomes the job's `returnvalue`, surfaced by `dispatch`/`waitUntilFinished`).
type JobRunner = (job: Job, fn: () => Promise<unknown>) => Promise<unknown>
let jobRunner: JobRunner = (_job, fn) => fn()
export function setJobRunner(runner: JobRunner): void {
  jobRunner = runner
}

/**
 * Run a job's processor inside a per-job logger scope (rfcs/RUNTIME_LOGGER.md — Phase 4).
 *
 * The scope logger is correlated (`{queue, jobId, attempt}`), tagged `queue:<name>`, and FANNED
 * OUT to BullMQ's persisted `job.log` (dashboard) at/above the job-log threshold — on top of the
 * normal stdout sink. So `getLogger()` inside the processor lands in both places, and `ctx.log`
 * routes through it too. Composes with `jobRunner` (which `useQueues` sets to `getDatabase().run`).
 * Exported for testing with a mock job (no Redis).
 */
export async function runJobWithLogging<T, R>(
  queueName: string,
  job: Job<T>,
  data: T,
  handler: Processor<T, R>
): Promise<R> {
  const jobLog = getRootLogger()
    .child({queue: queueName, jobId: job.id, attempt: job.attemptsMade + 1})
    .withTag(`queue:${queueName}`)
    .tee(record => void job.log(renderLine(record)).catch(() => {}), jobLogLevel())
  return (await runWithLogger(jobLog, () =>
    jobRunner(job, () =>
      Promise.resolve(handler({data, job, log: async m => void jobLog.info(m)}))
    )
  )) as R
}

export class QueueDefinition<T, R = void> {
  // BullMQ's generics are intricate; we keep the public API typed and treat the
  // BullMQ instances loosely at the boundary (runtime types are correct).
  private _queue?: BullQueue<T>
  private _events?: QueueEvents
  private worker?: Worker<T, R>
  private handler?: Processor<T, R>

  constructor(
    readonly name: string,
    private readonly options: QueueOptions<T> = {}
  ) {}

  /** Serializable metadata for `pylon inspect` (no Redis, no payload). */
  describe(): {
    name: string
    attempts?: number
    concurrency?: number
    hasSchema: boolean
  } {
    return {
      name: this.name,
      attempts: this.options.attempts,
      concurrency: this.options.concurrency,
      hasSchema: Boolean(this.options.schema)
    }
  }

  /**
   * The QueueEvents stream for this queue (lazy — needs its OWN blocking Redis
   * connection, so it's duplicated off the shared one). Only `dispatch`'s
   * `waitUntilFinished` uses it; defining/enqueuing never opens it.
   */
  private get queueEvents(): QueueEvents {
    if (!this._events) {
      this._events = new QueueEvents(this.name, {
        connection: getConnection().duplicate() as any
      })
    }
    return this._events
  }

  /**
   * The BullMQ queue, constructed LAZILY on first use. Merely *defining* a queue
   * (which happens whenever the app is imported — incl. the build/project-bridge and
   * tests) must NOT open a Redis connection: an eager connection keeps those
   * short-lived processes from exiting. Only `.add()` (enqueue) and the worker
   * touch it.
   */
  private get queue(): BullQueue<T> {
    if (!this._queue) {
      this._queue = new BullQueue(this.name, {
        connection: getConnection() as any,
        defaultJobOptions: {
          attempts: this.options.attempts ?? 1,
          backoff: this.options.backoff,
          removeOnComplete: this.options.removeOnComplete ?? {count: 1000, age: 24 * 3600},
          removeOnFail: this.options.removeOnFail ?? {count: 5000}
        } as any
      }) as BullQueue<T>
    }
    return this._queue
  }

  private validate(data: unknown): T {
    return this.options.schema ? this.options.schema.parse(data) : (data as T)
  }

  /**
   * Enqueue a job (validated). `jobId` in `options` dedupes. If a DB transaction
   * is active (and an outbox driver is set), routes through the transactional
   * outbox so the job is enqueued iff the transaction commits; otherwise enqueues
   * straight to Redis.
   */
  async add(data: T, options?: JobsOptions): Promise<void> {
    const validated = this.validate(data)
    const driver = getOutboxDriver()
    if (driver?.inTransaction()) {
      await driver.enqueue(this.name, validated, options)
    } else {
      await this.queue.add(this.name as any, validated as any, options)
    }
  }

  /** Enqueue after a delay (ms). */
  async addDelayed(data: T, delayMs: number, options?: JobsOptions): Promise<void> {
    await this.add(data, {...options, delay: delayMs})
  }

  /**
   * SYNCHRONOUS dispatch: enqueue a job and await its result (the processor's
   * return value `R`), rejecting if the job fails. Unlike `add` (fire-and-forget,
   * outbox-routed when in a txn), this enqueues straight to Redis and blocks on
   * completion via QueueEvents — so it needs a RUNNING worker (in-process dev, or
   * a separate `pylon worker`). NOT transactional: you're awaiting the result, so
   * the outbox's enqueue-iff-commit guarantee doesn't apply — call it outside a
   * transaction, or accept that the job runs regardless of the txn's outcome.
   */
  async dispatch(data: T, options?: JobsOptions): Promise<R> {
    const validated = this.validate(data)
    const job = await this.queue.add(this.name as any, validated as any, options)
    return (await job.waitUntilFinished(this.queueEvents)) as R
  }

  /**
   * REGISTER a processor (does not start consuming). Safe to call on import in
   * any process — only `startWorker()`/`startWorkers()` (the worker process)
   * actually consumes. The processor's return value is the job result surfaced by
   * `dispatch`. Returns `this` for chaining.
   */
  process(handler: Processor<T, R>): this {
    this.handler = handler
    return this
  }

  /** Start consuming (worker process only). No-op without a registered handler. */
  startWorker(): Worker<T, R> | undefined {
    if (!this.handler || this.worker) return this.worker
    const handler = this.handler
    const queueName = this.name
    this.worker = new Worker<T, R>(
      this.name,
      async job => runJobWithLogging(queueName, job, this.validate(job.data), handler),
      {connection: getConnection() as any, concurrency: this.options.concurrency ?? 1}
    )
    return this.worker
  }

  /** Schedule a repeatable (cron) job. Idempotent (BullMQ dedupes by repeat key). */
  async scheduleRepeatable(pattern: string): Promise<void> {
    await this.queue.add(this.name as any, undefined as any, {
      repeat: {pattern},
      removeOnComplete: true
    })
  }

  /** Close the worker (if started), the QueueEvents stream, and the queue. */
  async close(): Promise<void> {
    await this.worker?.close()
    await this._events?.close()
    await this._queue?.close()
  }

  /** @internal raw BullMQ queue (escape hatch / observability). */
  get bull(): BullQueue<T> {
    return this.queue
  }
}

/**
 * Define (and register) a typed queue. The optional second type param `R` is the
 * processor's RESULT type, surfaced by `dispatch` (defaults to `void` for
 * fire-and-forget queues).
 */
export function defineQueue<T = unknown, R = void>(
  name: string,
  options: QueueOptions<T> = {}
): QueueDefinition<T, R> {
  const existing = registry.get(name)
  if (existing) return existing as QueueDefinition<T, R>
  const q = new QueueDefinition<T, R>(name, options)
  registry.set(name, q)
  return q
}

/** Every queue defined this process (used by the worker runner + observability). */
export function registeredQueues(): QueueDefinition<unknown, unknown>[] {
  return [...registry.values()]
}

interface CronEntry {
  queue: QueueDefinition<void, void>
  pattern: string
}
const crons: CronEntry[] = []

/**
 * Define a scheduled (cron / repeatable) job: a queue whose handler runs on the
 * `pattern` schedule. The repeatable is scheduled when workers start.
 *
 *   cron('email-sync', '*\/10 * * * * *', async () => { … })  // every 10s
 */
export function cron(
  name: string,
  pattern: string,
  handler: Processor<void>,
  options: QueueOptions<void> = {}
): QueueDefinition<void> {
  const q = defineQueue<void>(name, options)
  q.process(handler)
  crons.push({queue: q, pattern})
  return q
}

/**
 * Schedule an ALREADY-defined queue as a repeatable cron. Like `cron()` but for a
 * queue whose handler is already registered (the class-queue path). Deferred to
 * `startWorkers()` so registration never opens a Redis connection.
 */
export function registerCron(queue: QueueDefinition<void, void>, pattern: string): void {
  crons.push({queue, pattern})
}

/**
 * Start consuming for every registered queue with a handler, and schedule all
 * crons. Call this in the worker process (`pylon worker`) or in-process dev mode.
 */
export async function startWorkers(): Promise<void> {
  for (const q of registeredQueues()) q.startWorker()
  for (const {queue, pattern} of crons) await queue.scheduleRepeatable(pattern)
}
