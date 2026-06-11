/**
 * `useQueues()` — runtime wiring for the queues, structurally a Pylon plugin (no
 * hard `@getcronit/pylon` dependency). It:
 *  - sets the Redis connection,
 *  - binds the ORM so jobs can use `Model.objects` (each job runs inside the
 *    ambient DB connection),
 *  - wires the transactional outbox (when pylon-db is present),
 *  - optionally starts the workers + relay IN THIS PROCESS (dev). In production
 *    run a separate worker (`pylon worker`); the web process only enqueues.
 */
import type {RedisOptions} from 'ioredis'
import {setConnection} from './connection.js'
import {createPgOutbox} from './pg-outbox.js'
import {runOutboxRelay, setOutboxDriver} from './outbox.js'
import {setJobRunner, startWorkers} from './queue.js'

export interface UseQueuesOptions {
  /** Redis connection (URL or options). Defaults to `REDIS_URL`. */
  connection?: string | RedisOptions
  /** Wire the Postgres transactional outbox (needs pylon-db). Default: true. */
  outbox?: boolean
  /**
   * Start workers + the outbox relay in THIS process. Use `'in-process'` for dev;
   * in production leave it off and run a dedicated `pylon worker`.
   */
  worker?: 'in-process' | false
}

export interface QueuesPlugin {
  strategy: 'last'
  setup(): Promise<void>
}

export function useQueues(options: UseQueuesOptions = {}): QueuesPlugin {
  return {
    strategy: 'last',
    async setup() {
      if (options.connection) setConnection(options.connection)

      // Optional ORM integration: bind the DB per job + wire the outbox.
      try {
        const {getDatabase} = (await import('@getcronit/pylon-db')) as {
          getDatabase: () => {run: <T>(fn: () => T) => T}
        }
        // Run each job inside the ambient DB connection → Model.objects works.
        setJobRunner((_job, fn) => getDatabase().run(fn))
        if (options.outbox !== false) setOutboxDriver(await createPgOutbox())
      } catch {
        /* pylon-db not installed → queues still work, without ORM/outbox. */
      }

      if (options.worker === 'in-process') {
        await startWorkers()
        runOutboxRelay()
      }
    }
  }
}
