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
import {Queue as BullQueue, Worker, type Job, type JobsOptions} from 'bullmq'
import {getConnection} from './connection.js'
import {getOutboxDriver} from './outbox.js'

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

export type Processor<T> = (ctx: JobContext<T>) => Promise<void> | void

const registry = new Map<string, QueueDefinition<any>>()

// A wrapper run around every job (set by useQueues to bind the ORM connection /
// tenant). Default: run the handler directly.
type JobRunner = (job: Job, fn: () => Promise<void>) => Promise<void>
let jobRunner: JobRunner = (_job, fn) => fn()
export function setJobRunner(runner: JobRunner): void {
  jobRunner = runner
}

export class QueueDefinition<T> {
  // BullMQ's generics are intricate; we keep the public API typed and treat the
  // BullMQ instances loosely at the boundary (runtime types are correct).
  private _queue?: BullQueue<T>
  private worker?: Worker<T>
  private handler?: Processor<T>

  constructor(
    readonly name: string,
    private readonly options: QueueOptions<T> = {}
  ) {}

  /**
   * The BullMQ queue, constructed LAZILY on first use. Merely *defining* a queue
   * (which happens whenever the app is imported — incl. the build/orm-bridge and
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
   * REGISTER a processor (does not start consuming). Safe to call on import in
   * any process — only `startWorker()`/`startWorkers()` (the worker process)
   * actually consumes. Returns `this` for chaining.
   */
  process(handler: Processor<T>): this {
    this.handler = handler
    return this
  }

  /** Start consuming (worker process only). No-op without a registered handler. */
  startWorker(): Worker<T> | undefined {
    if (!this.handler || this.worker) return this.worker
    const handler = this.handler
    this.worker = new Worker<T>(
      this.name,
      async job => {
        const data = this.validate(job.data)
        await jobRunner(job, () =>
          Promise.resolve(handler({data, job, log: async m => void (await job.log(m))}))
        )
      },
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

  /** Close the worker (if started) and the queue (only if it was constructed). */
  async close(): Promise<void> {
    await this.worker?.close()
    await this._queue?.close()
  }

  /** @internal raw BullMQ queue (escape hatch / observability). */
  get bull(): BullQueue<T> {
    return this.queue
  }
}

/** Define (and register) a typed queue. */
export function defineQueue<T = unknown>(name: string, options: QueueOptions<T> = {}): QueueDefinition<T> {
  const existing = registry.get(name)
  if (existing) return existing as QueueDefinition<T>
  const q = new QueueDefinition<T>(name, options)
  registry.set(name, q)
  return q
}

/** Every queue defined this process (used by the worker runner + observability). */
export function registeredQueues(): QueueDefinition<unknown>[] {
  return [...registry.values()]
}

interface CronEntry {
  queue: QueueDefinition<void>
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
 * Start consuming for every registered queue with a handler, and schedule all
 * crons. Call this in the worker process (`pylon worker`) or in-process dev mode.
 */
export async function startWorkers(): Promise<void> {
  for (const q of registeredQueues()) q.startWorker()
  for (const {queue, pattern} of crons) await queue.scheduleRepeatable(pattern)
}
