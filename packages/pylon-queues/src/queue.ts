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

export class QueueDefinition<T> {
  // BullMQ's generics are intricate; we keep the public API typed and treat the
  // BullMQ instances loosely at the boundary (runtime types are correct).
  private readonly queue: BullQueue<T>
  private worker?: Worker<T>

  constructor(
    readonly name: string,
    private readonly options: QueueOptions<T> = {}
  ) {
    this.queue = new BullQueue(name, {
      connection: getConnection() as any,
      defaultJobOptions: {
        attempts: options.attempts ?? 1,
        backoff: options.backoff,
        removeOnComplete: options.removeOnComplete ?? {count: 1000, age: 24 * 3600},
        removeOnFail: options.removeOnFail ?? {count: 5000}
      } as any
    }) as BullQueue<T>
  }

  private validate(data: unknown): T {
    return this.options.schema ? this.options.schema.parse(data) : (data as T)
  }

  /** Enqueue a job (validated). `jobId` in `options` dedupes. */
  async add(data: T, options?: JobsOptions): Promise<void> {
    await this.queue.add(this.name as any, this.validate(data) as any, options)
  }

  /** Enqueue after a delay (ms). */
  async addDelayed(data: T, delayMs: number, options?: JobsOptions): Promise<void> {
    await this.add(data, {...options, delay: delayMs})
  }

  /**
   * Register the processor and START consuming (call this in the worker process,
   * not the web process). Returns the BullMQ Worker.
   */
  process(handler: Processor<T>): Worker<T> {
    this.worker = new Worker<T>(
      this.name,
      async job => {
        const data = this.validate(job.data)
        await handler({
          data,
          job,
          log: async m => {
            await job.log(m)
          }
        })
      },
      {connection: getConnection() as any, concurrency: this.options.concurrency ?? 1}
    )
    return this.worker
  }

  /** Close the worker (if started) and the queue. */
  async close(): Promise<void> {
    await this.worker?.close()
    await this.queue.close()
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
