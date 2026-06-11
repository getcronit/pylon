/**
 * Postgres-backed OutboxDriver, wired to the pylon-db ORM. Imports pylon-db +
 * kysely DYNAMICALLY so the queue core stays usable without the ORM.
 *
 *   import {createPgOutbox, setOutboxDriver, runOutboxRelay} from '@getcronit/pylon-queues'
 *   setOutboxDriver(await createPgOutbox())   // web + worker
 *   const stop = runOutboxRelay()              // worker process only
 */
import type {JobsOptions} from 'bullmq'
import type {OutboxDriver, OutboxRow} from './outbox.js'

const TABLE = '_pylon_outbox'

export async function createPgOutbox(): Promise<OutboxDriver> {
  const {getDatabase, inTransaction} = (await import('@getcronit/pylon-db')) as {
    getDatabase: () => {kysely: any}
    inTransaction: () => boolean
  }
  const {sql} = (await import('kysely')) as {sql: any}

  // Idempotent table creation (runs once at wiring time).
  await sql
    .raw(
      `CREATE TABLE IF NOT EXISTS "${TABLE}" ` +
        `(id bigserial PRIMARY KEY, queue text NOT NULL, data jsonb NOT NULL, opts jsonb, ` +
        `created_at timestamptz NOT NULL DEFAULT now())`
    )
    .execute(getDatabase().kysely)

  return {
    inTransaction,

    async enqueue(queue: string, data: unknown, opts?: JobsOptions): Promise<void> {
      // Uses the AMBIENT (transactional) connection → atomic with the business write.
      await sql`
        INSERT INTO ${sql.ref(TABLE)} (queue, data, opts)
        VALUES (${queue}, ${JSON.stringify(data)}::jsonb, ${opts ? JSON.stringify(opts) : null}::jsonb)
      `.execute(getDatabase().kysely)
    },

    async claim(limit: number): Promise<OutboxRow[]> {
      // Atomic claim+remove of committed rows; SKIP LOCKED lets relays run in parallel.
      const res = await sql`
        DELETE FROM ${sql.ref(TABLE)}
        WHERE id IN (
          SELECT id FROM ${sql.ref(TABLE)} ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
        )
        RETURNING id, queue, data, opts
      `.execute(getDatabase().kysely)
      return (res.rows as Array<{id: string; queue: string; data: unknown; opts: unknown}>).map(
        r => ({
          id: r.id,
          queue: r.queue,
          data: r.data, // pg parses jsonb → JS value
          opts: (r.opts ?? undefined) as JobsOptions | undefined
        })
      )
    }
  }
}
