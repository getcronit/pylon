import IORedis, {type RedisOptions} from 'ioredis'
import {getRootLogger} from '@getcronit/pylon'

let connection: IORedis | undefined

// Throttle the "can't reach Redis" warning so a down Redis logs ONE helpful line
// instead of flooding the terminal on every reconnect attempt.
let lastWarnAt = 0
const WARN_INTERVAL_MS = 10_000

/**
 * Attach a Redis `error` handler. Without ANY `error` listener, ioredis logs every
 * failed reconnect itself as `[ioredis] Unhandled error event: … ECONNREFUSED`,
 * which floods the terminal when Redis is down (e.g. `pylon dev` with no Redis
 * running) and buries the dev server's own output. We swallow the flood and emit a
 * single throttled, actionable line instead. The connection keeps retrying in the
 * background, so queues recover automatically once Redis is reachable again.
 */
function attachErrorHandler(conn: IORedis): IORedis {
  conn.on('error', err => {
    const code = (err as {code?: string})?.code
    // Connection-level noise (Redis down / unreachable) → throttle to one line.
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
      const now = Date.now()
      if (now - lastWarnAt < WARN_INTERVAL_MS) return
      lastWarnAt = now
      warn(
        `Cannot reach Redis at ${redisTarget(conn)} (${code}) — queues are paused ` +
          `and will resume automatically once Redis is reachable. ` +
          `Start Redis (e.g. \`brew services start redis\` or \`docker run -p 6379:6379 redis\`) ` +
          `or set REDIS_URL.`
      )
      return
    }
    // Anything else is a real, unexpected error — surface it (still handled, so it
    // never becomes an ioredis "Unhandled error event" flood or crashes the process).
    warn(`Redis error: ${err instanceof Error ? err.message : String(err)}`)
  })
  return conn
}

function redisTarget(conn: IORedis): string {
  const opts = (conn as unknown as {options?: {host?: string; port?: number}}).options
  return opts?.host ? `${opts.host}:${opts.port ?? 6379}` : 'the configured host'
}

function warn(message: string): void {
  getRootLogger().withTag('queues').warn(message)
}

/** The shared Redis connection for all queues/workers (lazy, from `REDIS_URL`). */
export function getConnection(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
    // `maxRetriesPerRequest: null` is required by BullMQ (blocking commands).
    connection = attachErrorHandler(new IORedis(url, {maxRetriesPerRequest: null}))
  }
  return connection
}

/** Override the shared connection (tests / custom config via `useQueues`). */
export function setConnection(conn: IORedis | RedisOptions | string): void {
  connection =
    typeof conn === 'string'
      ? attachErrorHandler(new IORedis(conn, {maxRetriesPerRequest: null}))
      : conn instanceof IORedis
        ? attachErrorHandler(conn)
        : attachErrorHandler(new IORedis({...conn, maxRetriesPerRequest: null}))
}

export async function closeConnection(): Promise<void> {
  // `disconnect()` (not `quit()`) so a shutdown while Redis is DOWN returns
  // immediately instead of waiting on a `QUIT` command that can never be sent —
  // otherwise `Ctrl+C` hangs on the very reconnect loop we're trying to stop.
  connection?.disconnect(false)
  connection = undefined
}
