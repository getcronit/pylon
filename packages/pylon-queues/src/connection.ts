import IORedis, {type RedisOptions} from 'ioredis'

let connection: IORedis | undefined

/** The shared Redis connection for all queues/workers (lazy, from `REDIS_URL`). */
export function getConnection(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
    // `maxRetriesPerRequest: null` is required by BullMQ (blocking commands).
    connection = new IORedis(url, {maxRetriesPerRequest: null})
  }
  return connection
}

/** Override the shared connection (tests / custom config via `useQueues`). */
export function setConnection(conn: IORedis | RedisOptions | string): void {
  connection =
    typeof conn === 'string'
      ? new IORedis(conn, {maxRetriesPerRequest: null})
      : conn instanceof IORedis
        ? conn
        : new IORedis({...conn, maxRetriesPerRequest: null})
}

export async function closeConnection(): Promise<void> {
  await connection?.quit().catch(() => {})
  connection = undefined
}
