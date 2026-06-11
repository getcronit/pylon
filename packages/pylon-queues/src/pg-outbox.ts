/**
 * Postgres-backed OutboxDriver, wired to the pylon-db ORM.
 *
 * It uses pylon-db's exposed `getDatabase().kysely` (the ambient connection) — no
 * direct `kysely` dependency, and pylon-db is imported DYNAMICALLY so the queue
 * core stays usable without the ORM. It deliberately does NOT use the ORM model
 * layer (Manager/signals/tenant-scoping): the outbox is infrastructure, so writes
 * must bypass signals + tenant filters. Job data/opts are stored as TEXT (JSON)
 * to avoid jsonb-cast plumbing and handle any JSON value.
 */
import {randomUUID} from 'node:crypto'
import type {JobsOptions} from 'bullmq'
import type {OutboxDriver, OutboxRow} from './outbox.js'

const TABLE = '_pylon_outbox'

export async function createPgOutbox(): Promise<OutboxDriver> {
  const {getDatabase, inTransaction} = (await import('@getcronit/pylon-db')) as {
    getDatabase: () => {kysely: any}
    inTransaction: () => boolean
  }
  const k = () => getDatabase().kysely

  // Idempotent table creation (runs once at wiring time, outside a txn).
  await k()
    .schema.createTable(TABLE)
    .ifNotExists()
    .addColumn('id', 'text', (c: any) => c.primaryKey())
    .addColumn('queue', 'text', (c: any) => c.notNull())
    .addColumn('data', 'text', (c: any) => c.notNull())
    .addColumn('opts', 'text')
    .addColumn('created_at', 'timestamptz', (c: any) => c.notNull())
    .execute()

  return {
    inTransaction,

    async enqueue(queue: string, data: unknown, opts?: JobsOptions): Promise<void> {
      // Ambient (transactional) connection → atomic with the business write.
      await k()
        .insertInto(TABLE)
        .values({
          id: randomUUID(),
          queue,
          data: JSON.stringify(data),
          opts: opts ? JSON.stringify(opts) : null,
          created_at: new Date()
        })
        .execute()
    },

    async claim(limit: number): Promise<OutboxRow[]> {
      // Atomic claim+remove of committed rows; SKIP LOCKED lets relays run in
      // parallel. Postgres-specific (dialect override point): FOR UPDATE SKIP
      // LOCKED (also MySQL 8). A different store would need its own claim scheme.
      const rows = (await k()
        .deleteFrom(TABLE)
        .where('id', 'in', (eb: any) =>
          eb
            .selectFrom(TABLE)
            .select('id')
            .orderBy('created_at')
            .orderBy('id')
            .limit(limit)
            .forUpdate()
            .skipLocked()
        )
        .returningAll()
        .execute()) as Array<{
        id: string
        queue: string
        data: string
        opts: string | null
        created_at: string | Date
      }>

      // FIFO on the claimed batch (DELETE … RETURNING isn't ordered).
      return rows
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map(r => ({
          id: r.id,
          queue: r.queue,
          data: JSON.parse(r.data),
          opts: (r.opts ? JSON.parse(r.opts) : undefined) as JobsOptions | undefined
        }))
    }
  }
}
