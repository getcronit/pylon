/**
 * Transactional outbox — makes "enqueue a job when a row changes" correct.
 *
 * A signal/resolver that calls `queue.add()` INSIDE a DB transaction would
 * otherwise dual-write (Postgres + Redis): on rollback you'd get a phantom job;
 * a crash after commit loses it. The outbox fixes this: when a transaction is
 * active, `add()` writes a row to an outbox TABLE in that same transaction
 * (atomic with the business write). A relay then drains COMMITTED rows into
 * Redis — so a job is enqueued iff its transaction committed.
 *
 * The DB specifics live behind an `OutboxDriver` (see pg-outbox.ts), so the queue
 * core stays standalone (no ORM/SQL dependency).
 */
import type {JobsOptions} from 'bullmq'
import {registeredQueues} from './queue.js'
import {getRootLogger, runWithLogger} from '@getcronit/pylon'

export interface OutboxRow {
  id: number | string
  queue: string
  data: unknown
  opts?: JobsOptions
}

export interface OutboxDriver {
  /** Is a DB transaction currently active (→ route add() through the outbox)? */
  inTransaction(): boolean
  /** Write an outbox row using the AMBIENT (transactional) DB connection. */
  enqueue(queue: string, data: unknown, opts?: JobsOptions): Promise<void>
  /** Atomically claim + remove up to `limit` committed rows (FIFO). */
  claim(limit: number): Promise<OutboxRow[]>
}

let driver: OutboxDriver | undefined

export function setOutboxDriver(d: OutboxDriver | undefined): void {
  driver = d
}
export function getOutboxDriver(): OutboxDriver | undefined {
  return driver
}

/** Drain one batch of committed outbox rows into their BullMQ queues. */
export async function relayOnce(limit = 100): Promise<number> {
  if (!driver) return 0
  const rows = await driver.claim(limit)
  if (rows.length === 0) return 0
  const byName = new Map(registeredQueues().map(q => [q.name, q]))
  for (const row of rows) {
    const q = byName.get(row.queue)
    if (q) await q.bull.add(row.queue as never, row.data as never, row.opts)
  }
  return rows.length
}

/**
 * Run a polling relay loop (in the worker process). Drains until empty each tick,
 * then waits `intervalMs`. Returns a stop function. (A pg-NOTIFY adapter could
 * later wake this instantly instead of polling.)
 */
export function runOutboxRelay(opts: {intervalMs?: number} = {}): () => Promise<void> {
  const interval = opts.intervalMs ?? 1000
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    if (stopped) return
    // Run the drain inside an `outbox`-tagged logger scope so relay logs are correlated, and
    // surface transient DB/Redis errors (previously swallowed silently) at warn — the loop
    // still retries next tick.
    const log = getRootLogger().withTag('outbox')
    try {
      await runWithLogger(log, async () => {
        while ((await relayOnce()) > 0) {
          /* drain */
        }
      })
    } catch (err) {
      log.warn('relay tick failed (retrying next tick)', {err})
    }
    if (!stopped) timer = setTimeout(tick, interval)
  }
  timer = setTimeout(tick, interval)
  return async () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
